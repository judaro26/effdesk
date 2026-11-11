// scripts/test-help-rich.js: RICH HELP ARTICLES: safe HTML, pictures, video, PDF import, categories, themes, and the redesigned help center ON A REAL POSTGRES: error tracking and alerts, browser error reports, health, the status page and its management, per-customer settings and suspension, the announcement banner, the signup switch, user lookup, and the audit log.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { helpAssets, helpCenter, tickets, adminDo, clientLog, health, statusPublic, me, signup } from '../src/handlers.js';
import { recordError, fingerprint } from '../src/errors.js';
import { logged, sinks } from '../src/log.js';
import { resetCache } from '../src/platform-settings.js';
import { createTicket } from '../src/tickets.js';
import { memoryStore } from '../src/storage.js';
import { encodePng } from '../src/pdf-import.js';
import fs from 'fs';
import { grantLicense } from '../src/license.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test', AXIOM_TOKEN: 'xaat-test', AXIOM_DATASET: 'effdesk' };
const { url } = await freshDb('ai'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); return { cookie, user: r.response.user, headers: new Headers({ cookie }) }; };

const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });


const A = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };


const store = memoryStore(), CTX = { pool, auth, mailer, store, env: ENV };
const P = (path, init) => helpCenter(new Request('https://x.test' + path, init), CTX);
const bob = await signUp('bob@other.test', 'Bob'); const other = await auth.api.createOrganization({ body: { name: 'Other Co', slug: 'otherco' }, headers: bob.headers });
const B = async (who, org, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: org.id, action, ...extra }) }), CTX); return { status: r.status, body: await r.json() }; };
const asset = async (who, org, kind, bytes) => { const r = await helpAssets(new Request(`http://x/api/help-assets/${kind}?org=${org.id}`, { method: 'POST', headers: { cookie: who.cookie }, body: bytes }), CTX); return { status: r.status, body: await r.json() }; };
const png = encodePng(2, 2, new Uint8Array(12).fill(200), 2);
// ---- articles in HTML
const dirty = '<h1>Set up billing</h1><p onclick="x()">Pay <b>online</b>.<script>alert(1)</script></p><h2>Step one</h2><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe></div><h2>Step two</h2><iframe src="https://evil.com/embed/1"></iframe><div class="callout tip">A tip</div>';
const sv = await A(olivia, 'article-save', { title: 'Billing basics', body: dirty, format: 'html', category: 'Billing', lang: 'en', status: 'published' });
check('an HTML article is saved', sv.status === 200 && sv.body.ok);
const got = (await A(olivia, 'article-get', { id: sv.body.id })).body.article;
check('it is stored cleaned, with a plain-text copy and its category', got.format === 'html' && !/script|onclick|evil\.com/.test(got.body) && /youtube-nocookie/.test(got.body) && got.category === 'Billing' && got.editHtml === got.body);
check('an empty HTML article is refused, a picture-only one is not', (await A(olivia, 'article-save', { title: 'x', body: '<p><br></p>', format: 'html' })).status === 400 && (await A(olivia, 'article-save', { title: 'Pic', body: '<figure><img src="https://e.com/a.png"></figure>', format: 'html', status: 'draft' })).status === 200);
const old = await A(olivia, 'article-save', { title: 'Old style', body: '# Heading\n\nSome **bold** text.', lang: 'en', status: 'published', category: 'Getting started' });
check('a text article still works and opens in the editor as html', (await A(olivia, 'article-get', { id: old.body.id })).body.article.editHtml.includes('<strong>bold</strong>'));
// ---- pictures
const up = await asset(olivia, acme, 'image', png); check('a picture is stored and gets a public address', up.status === 200 && new RegExp('^/help/acme/img/[a-f0-9-]{36}$').test(up.body.url));
let img = await P(up.body.url); check('it is served with the type found in its bytes, no sniffing and no scripts', img.status === 200 && img.headers.get('content-type') === 'image/png' && img.headers.get('x-content-type-options') === 'nosniff' && /sandbox/.test(img.headers.get('content-security-policy')) && Buffer.from(await img.arrayBuffer()).equals(png));
check('another workspace cannot serve it, and junk ids are 404', (await P(up.body.url.replace('/acme/', '/otherco/'))).status === 404 && (await P('/help/acme/img/not-an-id')).status === 404);
check('an SVG or a script cannot be stored as a picture, whatever the browser says', (await asset(olivia, acme, 'image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).status === 415 && (await asset(olivia, acme, 'image', Buffer.from('<script>alert(1)</script>........'))).status === 415);
check('pictures over 4 MB are refused', (await asset(olivia, acme, 'image', Buffer.concat([png, Buffer.alloc(4 * 1048576)]))).status === 413);
check('people outside the workspace cannot upload to it', (await asset(bob, acme, 'image', png)).status === 403 && (await helpAssets(new Request(`http://x/api/help-assets/image?org=${acme.id}`, { method: 'POST', body: png }), CTX)).status === 401);
const used = (await pool.query('select sum(size)::int n from help_images where org_id = $1', [acme.id])).rows[0].n; const { storageUsed } = await import('../src/attachments.js'); check('pictures count towards the workspace’s storage', (await storageUsed(pool, acme.id)) >= used && used === png.length);
// ---- PDF import (Team plan and up)
const pdf = fs.readFileSync(new URL('./fixtures/guide.pdf', import.meta.url));
const free = await asset(bob, other, 'pdf', pdf); check('on the free plan PDF import asks to upgrade', free.status === 402 && free.body.upgrade === true);
const imp = await asset(olivia, acme, 'pdf', pdf);
check('on a paid plan a PDF becomes an article with its title, structure, formatting, link and picture', imp.status === 200 && imp.body.title === 'Getting started with Acme' && /<h2>Create your account<\/h2>/.test(imp.body.html) && /<ol><li>Open the sign-up page\.<\/li>/.test(imp.body.html) && /<strong>Important: <\/strong>/.test(imp.body.html) && /<a href="https:\/\/acme\.example\/docs"[^>]*>Visit our website<\/a>/.test(imp.body.html) && imp.body.pictures === 1 && /<img src="\/help\/acme\/img\/[a-f0-9-]{36}"/.test(imp.body.html));
const pimg = imp.body.html.match(/\/help\/acme\/img\/[a-f0-9-]{36}/)[0]; check('the imported picture is real and public', (await P(pimg)).status === 200 && (await (await P(pimg)).arrayBuffer()).byteLength > 1000);
check('something that is not a PDF is refused', (await asset(olivia, acme, 'pdf', Buffer.from('hello world, not a pdf'))).status === 415);
// ---- the look
check('the free plan cannot pick a premium theme or a custom accent', (await B(bob, other, 'help-settings-save', { theme: 'sunset' })).status === 402 && (await B(bob, other, 'help-settings-save', { theme: 'classic', accent: '#2f6fed' })).status === 402);
check('but can set its own headline on Classic', (await B(bob, other, 'help-settings-save', { theme: 'classic', heroTitle: 'Hi from Other Co' })).status === 200);
check('a bad accent colour and an unknown theme are refused', (await A(olivia, 'help-settings-save', { theme: 'aurora', accent: 'red' })).status === 400 && (await A(olivia, 'help-settings-save', { theme: 'neon' })).status === 400);
check('only admins change the look', (await A(ann, 'help-settings-save', { theme: 'aurora' })).status === 403);
check('a paid workspace can', (await A(olivia, 'help-settings-save', { theme: 'aurora', accent: '#7c4dff', heroTitle: 'Acme help', heroSubtitle: 'Find answers fast' })).status === 200);
const hs = (await A(olivia, 'help-settings-get')).body; check('the settings say what the plan allows', hs.settings.theme === 'aurora' && hs.paid === true && hs.import === true && (await B(bob, other, 'help-settings-get')).body.paid === false);
// ---- the public help center
let home = await (await P('/help/acme')).text();
check('the home page has the hero with the headline, search, topics with counts and the request card', /data-htheme="aurora"/.test(home) && /--accent:#7c4dff/.test(home) && /<h1>Acme help<\/h1>/.test(home) && /Find answers fast/.test(home) && /class="search big"/.test(home) && /<h3>Billing<\/h3>/.test(home) && /<h3>Getting started<\/h3>/.test(home) && /1 article/.test(home) && /hc-cta/.test(home) && /Billing basics/.test(home));
const pgFree = await (await P('/help/otherco')).text(); check('a free workspace shows Classic with its own headline', /data-htheme="classic"/.test(pgFree) && !/--accent:/.test(pgFree) && /Hi from Other Co/.test(pgFree));
await pool.query("insert into help_settings (org_id, theme, accent) values ($1,'sunset','#ff0000') on conflict (org_id) do update set theme='sunset', accent='#ff0000'", [other.id]);
const pgDown = await (await P('/help/otherco')).text(); check('a workspace that lost the plan goes back to Classic, whatever was saved', /data-htheme="classic"/.test(pgDown) && !/--accent:/.test(pgDown));
const art = await P('/help/acme/a/billing-basics'); const ah = await art.text();
check('the article page: breadcrumb, contents, headings with ids, video, callout, vote', art.status === 200 && /hc-crumbs/.test(ah) && /Billing/.test(ah) && /class="hc-toc"/.test(ah) && /<h2 id="step-one">Step one<\/h2>/.test(ah) && /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/.test(ah) && /callout tip/.test(ah) && /hc-vote/.test(ah));
check('nothing unsafe reaches the page, even if the database were edited by hand', await (async () => { await pool.query("update help_articles set body = body || '<script>alert(1)</script><img src=x onerror=alert(1)>' where id = $1", [sv.body.id]); const t = await (await P('/help/acme/a/billing-basics')).text(); return !/<script>alert|onerror/.test(t); })());
const csp = art.headers.get('content-security-policy'); check('the page’s content policy allows our pictures and the three video hosts and no scripts', /script-src 'none'/.test(csp) && /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com https:\/\/www\.loom\.com/.test(csp) && /img-src 'self' https:/.test(csp));
const old2 = await (await P('/help/acme/a/old-style')).text(); check('an old text article renders as before', /<h2>Heading<\/h2>/.test(old2) && /<strong>bold<\/strong>/.test(old2));
const rel = await (await P('/help/acme/a/billing-basics')).text(); check('related articles come from the same category only', !/Old style/.test(rel.split('hc-related')[1] || ''));
check('a topic page lists its articles', /Old style/.test(await (await P('/help/acme/search?cat=Getting%20started&q=')).text()) && !/Billing basics/.test((await (await P('/help/acme/search?cat=Getting%20started&q=')).text()).split('<ul class="hc-results">')[1] || ''));
check('search finds words inside the HTML but not tag names', /Billing basics/.test(await (await P('/help/acme/search?q=Pay+online')).text()) && !/Billing basics/.test(await (await P('/help/acme/search?q=iframe')).text()));

// ---- hardening
const cross = async (headers) => (await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: olivia.cookie, ...headers }, body: JSON.stringify({ orgId: acme.id, action: 'init' }) }), CTX)).status;
check('a signed-in action sent from another website or subdomain is refused, our own pages are fine', await cross({ origin: 'https://evil.test' }) === 401 && await cross({ 'sec-fetch-site': 'same-site' }) === 401 && await cross({ origin: 'http://x', 'sec-fetch-site': 'same-origin' }) === 200);
const cached = await P('/help/acme'); check('anonymous help pages may be cached at the edge for a minute, signed-in ones never', /s-maxage=60/.test(cached.headers.get('netlify-cdn-cache-control') || '') && !(await P('/help/acme', { headers: { cookie: 'eff_portal=x' } })).headers.get('netlify-cdn-cache-control'));
const views0 = (await pool.query('select views from help_articles where id = $1', [sv.body.id])).rows[0].views;
await P('/help/acme/a/billing-basics', { headers: { 'user-agent': 'Googlebot/2.1' } }); await P('/help/acme/a/billing-basics', { headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
check('crawlers do not count as readers', (await pool.query('select views from help_articles where id = $1', [sv.body.id])).rows[0].views === views0 + 1);
let last = 200; for (let i = 0; i < 62; i++) last = (await P('/help/acme/search?q=billing', { headers: { 'x-nf-client-connection-ip': '7.7.7.7' } })).status;
check('searching is limited per visitor, and another visitor is not affected', last === 429 && (await P('/help/acme/search?q=billing', { headers: { 'x-nf-client-connection-ip': '8.8.4.4' } })).status === 200);

// ---- word-processor formatting reaches readers exactly
const wp = await A(olivia, 'article-save', { title: 'Formatting', body: '<p style="text-align:center;color:#c00;font-size:22px">Centred</p><table style="width:100%"><tr><th>A</th></tr><tr><td style="background-color:#eef2f7">1</td></tr></table><figure><img src="' + up.body.url + '" class="img-round img-shadow img-left" alt="p"><figcaption>Cap</figcaption></figure><p style="position:fixed;top:0">x</p>', format: 'html', status: 'published', category: 'Billing' });
const wph = await (await P('/help/acme/a/formatting')).text();
check('colours, sizes, alignment, table shading and picture effects arrive as written', /<p style="text-align:center;color:#c00;font-size:22px">Centred<\/p>/.test(wph) && /<td style="background-color:#eef2f7">/.test(wph) && /class="img-round img-shadow img-left"/.test(wph) && /<figcaption>Cap<\/figcaption>/.test(wph));
check('tables sit in a box that scrolls on phones, and nothing can be positioned over the page', /<div class="tbl-wrap"><table style="width:100%">/.test(wph) && !/position/.test(wph.split('<article')[1] || ''));
const txt = await A(olivia, 'article-save', { title: 'Plain text', body: 'First line\nSecond line\n\n![Screenshot](' + up.body.url + ')', status: 'published' });
const txth = await (await P('/help/acme/a/plain-text')).text();
check('a plain text article keeps its line breaks and shows pictures', /First line<br>Second line/.test(txth) && new RegExp('<img src="' + up.body.url + '" alt="Screenshot"').test(txth));
done();
