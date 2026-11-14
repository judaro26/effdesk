// scripts/test-help.js: THE HELP CENTER AND CUSTOMER PORTAL ON A REAL POSTGRES: writing articles and translations, the public pages, safe rendering, search, votes, and the sign-in-by-email portal for requesters.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets, helpCenter } from '../src/handlers.js';
import { renderBody } from '../src/help.js';
import { readSession, sessionCookie } from '../src/portal.js';
import { newToken } from '../src/requests.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery', ENV = { BETTER_AUTH_SECRET: SECRET };
const { url } = await freshDb('help'); await migrate(url);
const pool = makePool(url), outbox = [], mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { cookie, headers: new Headers({ cookie }), user: r.response.user }; };
const ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const acme = await auth.api.createOrganization({ body: { name: 'Acme Rentals', slug: 'acme' }, headers: ann.headers });
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
const call = async (who, body) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify(body) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const web = async (method, path, { body, cookie, headers = {} } = {}) => { const r = await helpCenter(new Request('https://app.effdesk.test' + path, { method, headers: { 'user-agent': 'Mozilla/5.0 (test browser)', ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers }, body: body ? new URLSearchParams(body).toString() : undefined, redirect: 'manual' }), { pool, mailer, env: ENV }); return { status: r.status, text: await r.text(), headers: r.headers }; };

// writing
check('an article needs a title and text', (await call(ann, { orgId: acme.id, action: 'article-save', title: '', body: 'x' })).status === 400 && (await call(ann, { orgId: acme.id, action: 'article-save', title: 'T', body: '' })).status === 400);
let en = await call(ann, { orgId: acme.id, action: 'article-save', title: 'How to pay rent', lang: 'en', status: 'published', body: '# Paying rent\n\nUse **the portal**. See [our site](https://acme.example/pay).\n\n- Log in\n- Press *Pay*\n\n1. First\n2. Second\n\n```\ncode <b>here</b>\n```\n<script>alert(1)</script> [bad](javascript:alert(1)) <img src=x onerror=alert(2)>' });
check('an article is created with a slug from its title', en.status === 200 && en.body.slug === 'how-to-pay-rent');
const es = await call(ann, { orgId: acme.id, action: 'article-save', title: 'Cómo pagar la renta', lang: 'es', status: 'published', body: 'Usa el portal para pagar la renta.', translationOf: en.body.id });
check('a Spanish translation is linked to the English article', es.status === 200 && es.body.slug === 'como-pagar-la-renta');
check('a second version in the same language, or a translation into the same language, is refused (409 / 400)', (await call(ann, { orgId: acme.id, action: 'article-save', title: 'Otra', lang: 'es', body: 'x', translationOf: en.body.id })).status === 409 && (await call(ann, { orgId: acme.id, action: 'article-save', title: 'Same', lang: 'en', body: 'x', translationOf: en.body.id })).status === 400);
const draft = await call(ann, { orgId: acme.id, action: 'article-save', title: 'Secret plans', lang: 'en', status: 'draft', body: 'Not public yet.' });
const dup = await call(ann, { orgId: acme.id, action: 'article-save', title: 'How to pay rent', lang: 'en', status: 'draft', body: 'Duplicate title' });
check('two articles with the same title get different slugs', dup.body.slug === 'how-to-pay-rent-2');
check('the language of an article cannot be changed after it is created', (await call(ann, { orgId: acme.id, action: 'article-save', id: en.body.id, title: 'x', lang: 'es', body: 'y' })).status === 400);
check('the agent list shows drafts too, and an article opens with its text', (await call(ann, { orgId: acme.id, action: 'article-list' })).body.articles.length === 4 && (await call(ann, { orgId: acme.id, action: 'article-get', id: en.body.id })).body.article.body.startsWith('# Paying rent'));
check('only members of the organization can write or read articles', (await call(otto, { orgId: acme.id, action: 'article-list' })).status === 403 && (await call(otto, { orgId: acme.id, action: 'article-save', title: 'x', body: 'y' })).status === 403);

// rendering
const h = renderBody('# Paying rent\n\nUse **the portal**. See [our site](https://acme.example/pay).\n\n- Log in\n- Press *Pay*\n\n1. First\n2. Second\n\n```\ncode <b>here</b>\n```\n<script>alert(1)</script> [bad](javascript:alert(1)) <img src=x onerror=alert(2)>');
check('the article text renders headings, bold, italic, links, lists and code blocks', /<h2>Paying rent<\/h2>/.test(h) && /<strong>the portal<\/strong>/.test(h) && /<a href="https:\/\/acme\.example\/pay" rel="nofollow noopener noreferrer">our site<\/a>/.test(h) && /<ul>\s*<li>Log in<\/li>\s*<li>Press <em>Pay<\/em><\/li>\s*<\/ul>/.test(h) && /<ol>/.test(h) && /<pre><code>code &lt;b&gt;here&lt;\/b&gt;<\/code><\/pre>/.test(h));
check('anything else is escaped: no script, no javascript: link, no HTML tags from the writer', !/<script|<img|href="javascript/i.test(h) && /&lt;script&gt;/.test(h));

// the public help center
let r = await web('GET', '/help/acme?lang=en');
check('the public home lists published articles and no drafts', r.status === 200 && /How to pay rent/.test(r.text) && !/Secret plans/.test(r.text) && /Acme Rentals/.test(r.text) && /Powered by EffDesk/.test(r.text));
r = await web('GET', '/help/acme', { headers: { 'accept-language': 'es-MX,es;q=0.9' } });
check('the language follows the browser, and the page says so in Spanish', /lang="es"/.test(r.text) && /Centro de ayuda/.test(r.text));
check('an unknown organization is a 404 page', (await web('GET', '/help/nobody')).status === 404 && (await web('GET', '/help/acme/a/secret-plans')).status === 404);
r = await web('GET', '/help/acme/a/how-to-pay-rent?lang=en');
check('an article page shows the rendered text, escaped, with a link to the Spanish version', r.status === 200 && /<h2>Paying rent<\/h2>/.test(r.text) && !/<script>alert/.test(r.text) && /Cómo pagar|Español/.test(r.text) && /como-pagar-la-renta\?lang=es/.test(r.text));
r = await web('GET', '/help/acme/a/how-to-pay-rent?lang=es');
check('asking for an article in Spanish when a translation exists redirects to it', r.status === 303 && /como-pagar-la-renta\?lang=es/.test(r.headers.get('location')));
check('searching finds by title or text, in the wanted language first, and says when there is nothing', /How to pay rent/.test((await web('GET', '/help/acme/search?q=portal&lang=en')).text) && /Nothing found for/.test((await web('GET', '/help/acme/search?q=zzzz&lang=en')).text) && !/Secret plans/.test((await web('GET', '/help/acme/search?q=plans')).text) && /Cómo pagar/.test((await web('GET', '/help/acme/search?q=renta&lang=es')).text));
check('search treats % as a plain character', /Nothing found/.test((await web('GET', '/help/acme/search?q=%25%25')).text));
r = await web('POST', '/help/acme/a/how-to-pay-rent/vote?lang=en', { body: { v: 'yes' } });
const seen = r.headers.get('set-cookie').split(';')[0];
await web('POST', '/help/acme/a/how-to-pay-rent/vote?lang=en', { body: { v: 'yes' }, cookie: seen });
let row = (await withOrg(pool, acme.id, c => c.query("select helpful_yes, helpful_no, views from help_articles where id = $1", [en.body.id]))).rows[0];
check('a vote is counted once per visitor (a cookie remembers it), and views are counted', r.status === 303 && row.helpful_yes === 1 && row.helpful_no === 0 && row.views >= 1);
check('a vote from another website is refused', (await web('POST', '/help/acme/a/how-to-pay-rent/vote', { body: { v: 'no' }, headers: { origin: 'https://evil.example' } })).status === 403);
r = await web('GET', '/help/acme');
check('the pages carry no script at all', !/<script/i.test(r.text) && /Content-Type/i.test('Content-Type') && r.headers.get('x-content-type-options') === 'nosniff');

// the customer portal
await call(ann, { orgId: acme.id, action: 'create', subject: 'Leaky tap', body: 'Drip drip.', requesterEmail: 'tina@example.com', requesterName: 'Tina' });
await call(ann, { orgId: acme.id, action: 'create', subject: 'Other person', body: 'Not yours.', requesterEmail: 'sam@example.com' });
await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'We will send a plumber.' });
await call(ann, { orgId: acme.id, action: 'note', number: 1, body: 'INTERNAL: tenant is late on rent' });
outbox.length = 0;
r = await web('POST', '/help/acme/tickets/login?lang=en', { body: { email: 'nobody@example.com' } });
const same = r.text.includes('we sent a sign-in link');
check('a sign-in link is NOT sent to an address with no requests, and the page says the same thing either way', same && outbox.length === 0);
r = await web('POST', '/help/acme/tickets/login?lang=en', { body: { email: ' Tina@Example.com ' } });
const link = outbox[0] && outbox[0].text.match(/https?:\/\/\S+\/tickets\/verify\?t=[^&\s]+&lang=en/);
check('an address with requests is emailed a one-time link to the portal (and the page says the same thing)', r.text.includes('we sent a sign-in link') && outbox.length === 1 && outbox[0].to === 'tina@example.com' && !!link && /Acme Rentals/.test(outbox[0].subject));
const tok = new URL(link[0].replace(/\.$/, '')).searchParams.get('t');
r = await web('GET', `/help/acme/tickets/verify?t=${tok}&lang=en`);
check('opening the link only shows a button (a mail scanner opening it must not use it up)', r.status === 200 && /<form method="post"/.test(r.text) && !r.headers.get('set-cookie'));
r = await web('POST', '/help/acme/tickets/verify?lang=en', { body: { t: tok } });
const sc = r.headers.get('set-cookie'), cookie = sc.split(';')[0];
check('confirming signs the requester in with an HttpOnly, SameSite cookie scoped to /help', r.status === 303 && /HttpOnly/.test(sc) && /SameSite=Lax/.test(sc) && /Path=\/help/.test(sc) && /^eff_portal=/.test(cookie));
check('the link works once only', (await web('POST', '/help/acme/tickets/verify?lang=en', { body: { t: tok } })).headers.get('location').includes('bad=1'));
r = await web('GET', '/help/acme/tickets?lang=en', { cookie });
check('the portal lists the requester\'s own requests only', /Leaky tap/.test(r.text) && !/Other person/.test(r.text) && /tina@example\.com/.test(r.text));
r = await web('GET', '/help/acme/tickets/1?lang=en', { cookie });
check('a request shows the public conversation but never internal notes', /Drip drip/.test(r.text) && /We will send a plumber/.test(r.text) && !/INTERNAL/.test(r.text) && /Waiting for you|Open|Pending/.test(r.text));
check('another person\'s request is a 404, and without a session the portal asks for sign-in', (await web('GET', '/help/acme/tickets/2?lang=en', { cookie })).status === 404 && /Sign in to see your requests/.test((await web('GET', '/help/acme/tickets')).text) && (await web('GET', '/help/acme/tickets/1')).status === 303);
check('a session for one organization does not open another', (await web('GET', '/help/beta/tickets', { cookie })).text.includes('Sign in to see') && readSession(ENV, cookie.split('=').slice(1).join('='), beta.id) === null);
const csrfMatch = r.text.match(/name="csrf" value="([^"]+)"/);
check('the portal reply form includes its CSRF token', !!csrfMatch);
const csrf = csrfMatch?.[1] || '';
check('a reply without the right form token is refused (403)', (await web('POST', '/help/acme/tickets/1/reply', { cookie, body: { body: 'hi', csrf: 'wrong' } })).status === 403 && (await web('POST', '/help/acme/tickets/1/reply', { cookie, body: { body: 'hi' } })).status === 403);
r = await web('POST', '/help/acme/tickets/1/reply?lang=en', { cookie, body: { body: 'Thank you, Thursday works.', csrf } });
const t1 = (await call(ann, { orgId: acme.id, action: 'get', number: 1 })).body;
check('a reply from the portal becomes a requester message and reopens the ticket', r.status === 303 && t1.messages.at(-1).kind === 'requester' && t1.messages.at(-1).body === 'Thank you, Thursday works.' && t1.ticket.status === 'open');
check('an empty reply is refused with a message', /Write a message first/.test((await web('POST', '/help/acme/tickets/1/reply?lang=en', { cookie, body: { body: '  ', csrf } })).text));
await call(ann, { orgId: acme.id, action: 'update', number: 1, patch: { status: 'closed' } });
r = await web('GET', '/help/acme/tickets/1?lang=en', { cookie });
check('a closed request offers no reply form', /closed/i.test(r.text) && !/<textarea/.test(r.text));
check('signing out clears the cookie', /Max-Age=0/.test((await web('POST', '/help/acme/tickets/logout', { cookie })).headers.get('set-cookie')));

// anonymous request form abuse protection
const formNow = Date.now(), formTs = newToken(ENV, acme.id, formNow - 4000);
const formBurst = [];
for (let i = 0; i < 11; i++) formBurst.push(await web('POST', '/help/acme/requests/new', { body: { ts: formTs, email: `requester${i}@example.com`, name: 'Requester', subject: 'Need help', description: 'Please contact me.' }, headers: { 'x-nf-client-connection-ip': '203.0.113.88' } }));
check('public request form submissions are limited per source IP', formBurst.slice(0, 10).every(x => x.status === 200) && formBurst[10].status === 429 && formBurst[10].headers.get('retry-after') === '600');
check('a tampered or expired cookie is not a session', readSession(ENV, cookie.split('=').slice(1).join('=') + 'x', acme.id) === null && readSession(ENV, sessionCookie(ENV, acme.id, 'tina@example.com', Date.now() - 13 * 3600 * 1000), acme.id) === null && readSession(ENV, sessionCookie(ENV, acme.id, 'tina@example.com'), acme.id).email === 'tina@example.com');
const burst = []; for (let i = 0; i < 11; i++) burst.push(await web('POST', '/help/acme/tickets/login', { body: { email: 'tina@example.com' }, headers: { 'x-nf-client-connection-ip': '203.0.113.77' } }));
check('customer portal sign-in requests are rate-limited per source IP', burst.slice(0, 10).every(x => x.status === 200) && burst[10].status === 429 && burst[10].headers.get('retry-after') === '600');
check('at most 5 links an hour go to one address', (await withOrg(pool, acme.id, c => c.query("select count(*)::int n from portal_links where email = 'tina@example.com'"))).rows[0].n <= 5);
check('the other organization\'s help center is separate and empty', /No articles yet/.test((await web('GET', '/help/beta?lang=en')).text));
await pool.end(); done();
