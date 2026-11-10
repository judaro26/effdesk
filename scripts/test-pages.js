// scripts/test-pages.js: THE PUBLIC SITE: landing and pricing match the plans, the legal pages exist and are linked, the sign-in pages work, and nothing breaks the strict content policy.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { JSDOM } from 'jsdom';
import { check, done } from './lib/check.js';
import { PLANS, FREE_SEATS } from '../src/plans.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..'), pub = f => fs.readFileSync(path.join(root, 'public', f), 'utf8'), tick = (ms = 10) => new Promise(r => setTimeout(r, ms));
const files = fs.readdirSync(path.join(root, 'public'), { recursive: true }).filter(f => /\.(html|js|css)$/.test(f));

const home = pub('index.html');
check('the landing page shows the free plan with 2 agents and each paid price (annual and monthly) from the plan table', new RegExp(`${FREE_SEATS} agents`).test(home) && ['team', 'suite', 'pro'].every(p => home.includes(`$${PLANS[p].price.year}<small>`) && home.includes(`$${PLANS[p].price.month} billed monthly`)));
check('the landing page links every legal page, and each exists', ['terms', 'privacy', 'refunds', 'dpa', 'subprocessors', 'aup'].every(p => home.includes(`/legal/${p}.html`) && fs.existsSync(path.join(root, 'public/legal', p + '.html'))));
check('every legal page is marked as a draft until a lawyer has approved it (remove the banner then)', fs.readdirSync(path.join(root, 'public/legal')).every(f => /data-draft="1"/.test(pub('legal/' + f))));
check('the privacy policy says customer data is never sold or used to train models, and the terms name Paddle as merchant of record', /does not sell|do not sell/i.test(pub('legal/privacy.html')) && /train AI models/.test(pub('legal/privacy.html')) && /merchant of record/.test(pub('legal/terms.html')));
check('the subprocessor list names the database, hosting, mail and payment providers', ['Neon', 'Netlify', 'Resend', 'Paddle'].every(n => pub('legal/subprocessors.html').includes(n)));
check('no page uses an inline script, an inline event handler or a third-party file except Paddle (the site policy allows none)', files.filter(f => f.endsWith('.html')).every(f => { const h = pub(f); return !/<script(?![^>]*\bsrc=)[^>]*>/.test(h) && !/\son[a-z]+\s*=/.test(h) && !/(src|href)="https?:\/\/(?!cdn\.paddle\.com)/.test(h.replace(/<a [^>]*>/g, '')); }));
check('the scripts build nothing as HTML', files.filter(f => f.endsWith('.js')).every(f => !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(pub(f))));
const toml = fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8');
check('the site policy allows scripts only from itself and Paddle, forbids framing and sets HSTS', /script-src 'self' https:\/\/cdn\.paddle\.com/.test(toml) && /frame-ancestors 'none'/.test(toml) && /Strict-Transport-Security/.test(toml));

// the sign-in page
const page = (file, search, js, g = {}) => { const dom = new JSDOM(pub(file), { runScripts: 'outside-only', url: 'https://app.test/' + file }); const w = dom.window; w.__EFFDESK_TEST__ = true; w.eval(pub(js)); return w; };
const mkFetch = routes => { const calls = []; const f = async (url, opts) => { calls.push([url, opts && opts.body ? JSON.parse(opts.body) : null]); const r = routes[url]; const x = typeof r === 'function' ? r(opts) : r || { status: 404, body: {} }; return { ok: x.status < 400, status: x.status, json: async () => x.body }; }; f.calls = calls; return f; };
const run = async (mode, routes, fill, extra = '') => { const w = page('auth.html', '', 'js/auth.js'), f = mkFetch(routes), nav = { search: `?mode=${mode}${extra}`, went: [], go(u) { this.went.push(u); } }; w.EffDeskAuth.start(w.document, f, nav); const D = w.document; Object.entries(fill || {}).forEach(([id, v]) => { const e = D.getElementById(id); if (e.type === 'checkbox') e.checked = v; else e.value = v; }); D.getElementById('f').dispatchEvent(new w.Event('submit', { cancelable: true })); await tick(30); return { D, f, nav, msg: D.getElementById('msg').textContent }; };
let r = await run('signin', { '/api/auth/sign-in/email': { status: 200, body: { user: {} } } }, { email: 'a@b.co', password: 'correct horse battery' });
check('signing in posts the details and goes to the welcome page, which sends people where they belong', r.f.calls[0][0] === '/api/auth/sign-in/email' && r.f.calls[0][1].email === 'a@b.co' && r.nav.went[0] === '/welcome.html');
r = await run('signin', { '/api/auth/sign-in/email': { status: 401, body: {} } }, { email: 'a@b.co', password: 'nope nope nope' });
check('a wrong password says so and goes nowhere', /did not work/.test(r.msg) && r.nav.went.length === 0);
r = await run('signin', { '/api/auth/sign-in/email': { status: 429, body: {} } }, { email: 'a@b.co', password: 'x' });
check('rate limiting is explained', /Too many attempts/.test(r.msg));
r = await run('signin', { '/api/auth/sign-in/email': { status: 200, body: { twoFactorRedirect: true } }, '/api/auth/two-factor/verify-totp': { status: 200, body: {} } }, { email: 'a@b.co', password: 'x' });
check('with two-step verification the page asks for the code', !r.D.getElementById('code').closest('[data-for]').hidden && r.nav.went.length === 0 && r.D.getElementById('password').closest('[data-for]').hidden);
const SU = { name: 'Ann', email: 'ann@x.co', password: 'long enough password', company: 'Acme Rentals', slug: 'acme', terms: true };
r = await run('signup', {}, { ...SU, password: 'short' });
check('sign-up refuses a short password, a missing agreement, a missing company or address and a bad email before sending anything', /at least 10/.test(r.msg) && r.f.calls.length === 0 && /agree/.test((await run('signup', {}, { ...SU, terms: false })).msg) && /company name/.test((await run('signup', {}, { ...SU, company: '' })).msg) && /workspace address/.test((await run('signup', {}, { ...SU, slug: 'a' })).msg) && /valid email/.test((await run('signup', {}, { ...SU, email: 'nope' })).msg));
r = await run('signup', { '/api/signup': { status: 200, body: { ok: true, slug: 'acme' } } }, SU);
check('sign-up posts the name, email, password, company and address to /api/signup, then replaces the form with a clear "Check your email" panel naming the address and the workspace', r.f.calls[0][0] === '/api/signup' && r.f.calls[0][1].company === 'Acme Rentals' && r.f.calls[0][1].slug === 'acme' && r.D.getElementById('f').hidden && !r.D.getElementById('done').hidden && /Check your email/.test(r.D.getElementById('done').textContent) && r.D.getElementById('doneemail').textContent === 'ann@x.co' && /acme/.test(r.D.getElementById('doneslug').textContent));
r = await run('signup', { '/api/signup': { status: 409, body: { message: 'That address is already taken.', code: 'SLUG_TAKEN' } } }, SU);
check('a taken address is said plainly, next to the address field, and the form stays', /already taken/.test(r.msg) && /already taken/.test(r.D.getElementById('slugnote').textContent) && !r.D.getElementById('f').hidden);
r = await run('signup', { '/api/signup': { status: 422, body: { message: 'User already exists' } } }, SU);
check('an address that already has an account is said plainly', /already an account/.test(r.msg));
{
  const w = page('auth.html', '', 'js/auth.js'), f = mkFetch({ '/api/workspace-check?slug=acme-rentals': { status: 200, body: { available: true, slug: 'acme-rentals' } }, '/api/workspace-check?slug=taken': { status: 200, body: { available: false, reason: 'That address is already taken.' } } }), nav = { search: '?mode=signup', went: [], go() {} };
  w.EffDeskAuth.start(w.document, f, nav); const D = w.document, type = (id, v) => { const e = D.getElementById(id); e.value = v; e.dispatchEvent(new w.Event('input')); };
  type('company', 'Acme Rentals'); await tick(450);
  check('typing a company name suggests the address and checks it live ("is available")', D.getElementById('slug').value === 'acme-rentals' && /acme-rentals is available/.test(D.getElementById('slugnote').textContent) && D.getElementById('slugnote').className.includes('ok') && f.calls.some(c => c[0] === '/api/workspace-check?slug=acme-rentals'));
  type('slug', 'taken'); await tick(450);
  const shownTaken = /already taken/.test(D.getElementById('slugnote').textContent) && D.getElementById('slugnote').className.includes('err'); type('company', 'Other Name');
  check('typing an address that is used shows why, and the address stops following the company name', shownTaken && D.getElementById('slug').value === 'taken', JSON.stringify(f.calls.map(c => c[0])) + D.getElementById('slug').value + ' | ' + D.getElementById('slugnote').textContent);
  const g = page('auth.html', '', 'js/auth.js'), f2 = mkFetch({ '/api/signup': { status: 200, body: { ok: true, slug: 'acme' } }, '/api/auth/send-verification-email': { status: 200, body: {} } });
  g.EffDeskAuth.start(g.document, f2, { search: '?mode=signup', went: [], go() {} });
  [['name', 'Ann'], ['email', 'ann@x.co'], ['password', 'long enough password'], ['company', 'Acme'], ['slug', 'acme']].forEach(([id, v]) => { g.document.getElementById(id).value = v; }); g.document.getElementById('terms').checked = true; g.document.getElementById('f').dispatchEvent(new g.Event('submit', { cancelable: true })); await tick(40);
  g.document.getElementById('resend').click(); await tick(40);
  check('the confirmation panel can send the email again (to the same address, returning to the welcome page)', f2.calls.some(c => c[0] === '/api/auth/send-verification-email' && c[1].email === 'ann@x.co' && c[1].callbackURL === '/welcome.html') && /Sent again/.test(g.document.getElementById('donemsg').textContent));
}
r = await run('forgot', { '/api/auth/request-password-reset': { status: 200, body: {} } }, { email: 'ann@x.co' });
check('the reset request never reveals whether the address has an account', /If there is an account/.test(r.msg) && r.f.calls[0][1].redirectTo === '/auth.html?mode=reset');
r = await run('reset', { '/api/auth/reset-password': { status: 200, body: {} } }, { password: 'a brand new password' }, '&token=abc');
check('the reset link\'s token and the new password are posted', r.f.calls[0][1].token === 'abc' && r.f.calls[0][1].newPassword === 'a brand new password' && r.nav.went[0] === '/auth.html?mode=signin');

// the account page
const app = async (me, routes) => { const w = page('app.html', '', 'js/app.js'), f = mkFetch({ '/api/me': me, ...routes }), nav = { went: [], go(u) { this.went.push(u); } }, opened = []; await w.EffDeskApp.start(w.document, f, nav, cfg => opened.push(cfg)); await tick(20); return { D: w.document, f, nav, opened, w }; };
const ME = { status: 200, body: { user: { email: 'o@x.co' }, organizations: [{ id: 'org1', name: 'Acme', slug: 'acme', role: 'owner', plan: 'free', license: null, seats: 2, seatsUsed: 1, features: [] }] } };
let A = await app({ status: 401, body: {} });
check('without a session the account page sends people to sign in', A.nav.went[0] === '/auth.html?mode=signin');
A = await app(ME, { '/api/billing/checkout': { status: 200, body: { priceId: 'pri_x', quantity: 3, customData: { org_id: 'org1' }, customerEmail: 'o@x.co', clientToken: 't', sandbox: true } }, '/api/auth/organization/invite-member': { status: 200, body: {} } });
check('it shows the organization, the plan and the seats in use', /Acme/.test(A.D.body.textContent) && /Plan: free · Agents: 1 of 2/.test(A.D.body.textContent));
A.D.querySelector('[data-upgrade="org1"]').click(); await tick(20);
check('"Continue to checkout" asks the server and opens Paddle with the details it returned', A.f.calls.some(c => c[0] === '/api/billing/checkout' && c[1].orgId === 'org1' && c[1].plan === 'team' && c[1].interval === 'year' && c[1].seats === 3) && A.opened[0].priceId === 'pri_x' && A.opened[0].customData.org_id === 'org1');
A.D.querySelector('input[aria-label="Agent email"]').value = 'new@x.co'; A.D.querySelector('[data-invite="org1"]').click(); await tick(20);
check('an invitation is sent through the organization endpoint', A.f.calls.some(c => c[0] === '/api/auth/organization/invite-member' && c[1].email === 'new@x.co' && c[1].role === 'member' && c[1].organizationId === 'org1') && /Invitation sent/.test(A.D.body.textContent));
A = await app(ME, { '/api/auth/organization/invite-member': { status: 403, body: { message: 'The free plan includes 2 agents. Upgrade to add more.' } } });
A.D.querySelector('input[aria-label="Agent email"]').value = 'third@x.co'; A.D.querySelector('[data-invite="org1"]').click(); await tick(20);
check('when the seats are full the reason is shown as it came from the server', /free plan includes 2 agents/.test(A.D.body.textContent));
A = await app({ status: 200, body: { user: { email: 'o@x.co' }, organizations: [{ ...ME.body.organizations[0], license: 'lifetime_unlimited', seats: null, seatsUsed: 9, plan: 'pro' }] } });
check('a licensed organization shows "Lifetime licence", unlimited agents and no upgrade button', /Lifetime licence/.test(A.D.body.textContent) && /\(unlimited\)/.test(A.D.body.textContent) && !A.D.querySelector('[data-upgrade]'));
A = await app({ status: 200, body: { user: { email: 'm@x.co' }, organizations: [{ ...ME.body.organizations[0], role: 'member' }] } });
check('an ordinary agent sees neither the invitation form nor the upgrade form', !A.D.querySelector('[data-invite]') && !A.D.querySelector('[data-upgrade]'));
A = await app({ status: 200, body: { user: { email: 'n@x.co' }, organizations: [] } }, { '/api/auth/organization/create': { status: 200, body: {} } });
A.D.querySelector('input[aria-label="Organization name"]').value = 'Brand New Co'; A.D.querySelector('[data-create-org]').click(); await tick(20);
check('a new person creates their organization with a URL-safe slug', A.f.calls.some(c => c[0] === '/api/auth/organization/create' && c[1].name === 'Brand New Co' && /^brand-new-co-[a-z0-9]{4}$/.test(c[1].slug)));

// the invitation page
const inv = async (search, me, accept) => { const w = page('accept-invitation.html', '', 'js/accept.js'), f = mkFetch({ '/api/me': me, '/api/auth/organization/accept-invitation': accept || { status: 200, body: {} } }), nav = { search, went: [], go(u) { this.went.push(u); } }; await w.EffDeskAccept.start(w.document, f, nav); await tick(20); return { D: w.document, f, nav }; };
let I = await inv('?id=inv1', { status: 200, body: {} });
check('a signed-in person accepts the invitation and lands on the account page', I.f.calls.some(c => c[0] === '/api/auth/organization/accept-invitation' && c[1].invitationId === 'inv1') && I.nav.went[0] === '/app.html');
I = await inv('?id=inv1', { status: 401, body: {} });
check('someone who is not signed in is told to sign in or sign up with the invited address', /Sign in or create an account/.test(I.D.body.textContent) && I.f.calls.length === 1);
I = await inv('?id=inv1', { status: 200, body: {} }, { status: 400, body: { message: 'Invitation not found or expired' } });
check('a bad invitation says why', /not found or expired/.test(I.D.body.textContent));
I = await inv('', { status: 200, body: {} });
check('a link with no id is refused', /not valid/.test(I.D.body.textContent));
done();
