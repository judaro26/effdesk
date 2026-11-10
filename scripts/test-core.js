// scripts/test-core.js: THE FOUNDATION ON A REAL POSTGRES: migrations, sign-up and sign-in, organizations and invitations with the seat limit, Paddle events, checkout, lifetime licences and tenant isolation.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth, authOptions } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { me, checkout, license, paddleWebhook } from '../src/handlers.js';
import { getEntitlements, seatsUsed, verifySignature, applyPaddleEvent } from '../src/billing.js';
import { getMigrations } from 'better-auth/db/migration';

const SECRET = crypto.randomBytes(32).toString('base64');
process.env.PLATFORM_ADMIN_EMAILS = 'owner@effdesk.test';
const ENV = { PADDLE_WEBHOOK_SECRET: 'whsec_test', PADDLE_CLIENT_TOKEN: 'live_token', PADDLE_ENV: 'sandbox', PADDLE_PRICE_TEAM_YEAR: 'pri_team_y', PADDLE_PRICE_TEAM_MONTH: 'pri_team_m', PADDLE_PRICE_SUITE_YEAR: 'pri_suite_y', PADDLE_PRICE_PRO_YEAR: 'pri_pro_y' };
const { url } = await freshDb('core');
const ran = await migrate(url);
check('the migrations apply in order, once each', ran.join() === '001_auth.sql,002_core.sql,003_tickets.sql,004_email.sql,005_attachments.sql,006_help.sql,007_import.sql,008_signup.sql,009_desk.sql,010_prefs.sql,011_sla_notify.sql,012_avatar_webhooks.sql,013_automations_csat_api.sql,014_org_settings.sql,015_hours_alerts_fields.sql,016_support_usage.sql,017_live_chat.sql,018_sso.sql,019_agent_numbers.sql' && (await migrate(url)).length === 0);
const pool = makePool(url);
const sent = [], mailer = makeMailer({ transport: async m => { sent.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const { toBeCreated, toBeAdded } = await getMigrations(authOptions({ pool, mailer, secret: SECRET }));
check('migrations/001_auth.sql matches the Better Auth configuration (regenerate with npm run auth:sql when it changes)', toBeCreated.length === 0 && toBeAdded.length === 0, JSON.stringify(toBeCreated.map(t => t.table)));

// people
const PW = 'correct horse battery';
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { headers: new Headers({ cookie }), user: r.response.user }; };
const owner = await signUp('owner@effdesk.test', 'Olivia Owner'), other = await signUp('other@effdesk.test', 'Otto Other');
const mkOrg = async (who, name, slug) => (await auth.api.createOrganization({ body: { name, slug }, headers: who.headers }));
const acme = await mkOrg(owner, 'Acme Rentals', 'acme'), beta = await mkOrg(other, 'Beta Homes', 'beta');
check('a person signs up, signs in (an HttpOnly cookie) and creates an organization', !!acme.id && acme.slug === 'acme' && (await pool.query('select role from member where "userId" = $1 and "organizationId" = $2', [owner.user.id, acme.id])).rows[0].role === 'owner');
const reqOf = (who, method, path, body) => new Request('http://localhost:8888' + path, { method, headers: { ...(who ? { cookie: who.headers.get('cookie') } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const deps = { pool, auth, env: ENV };
const asJson = async r => ({ status: r.status, body: await r.json() });

// the free plan: 2 agents
let r = await asJson(await me(reqOf(owner, 'GET', '/api/me'), deps));
check('"me" lists the organization with the free plan, 2 seats and 1 in use', r.status === 200 && r.body.user.email === 'owner@effdesk.test' && r.body.organizations.length === 1 && r.body.organizations[0].plan === 'free' && r.body.organizations[0].seats === 2 && r.body.organizations[0].seatsUsed === 1 && !r.body.organizations[0].features.includes('sla'));
check('"me" needs a sign-in', (await me(reqOf(null, 'GET', '/api/me'), deps)).status === 401);
const invite = (email, role = 'member') => auth.api.createInvitation({ body: { email, role, organizationId: acme.id }, headers: owner.headers }).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
let a1 = await invite('agent1@acme.test');
check('the second agent can be invited on the free plan, and the invitation email is sent', a1.ok && sent.some(m => m.to === 'agent1@acme.test' && /invited you to Acme Rentals/.test(m.subject) && /accept-invitation\?id=/.test(m.text)));
check('a pending invitation holds a seat', (await seatsUsed(pool, acme.id)) === 2);
let a2 = await invite('agent2@acme.test');
check('the third is refused with the reason, as a 403', !a2.ok && a2.e.statusCode === 403 && /free plan includes 2 agents/.test(a2.e.body.message) && a2.e.body.code === 'SEATS_FULL');
await pool.query(`update invitation set "expiresAt" = now() - interval '1 day' where "organizationId" = $1`, [acme.id]);
check('an expired invitation no longer holds a seat', (await seatsUsed(pool, acme.id)) === 1 && (await invite('agent2@acme.test')).ok);
await pool.query(`update invitation set status = 'canceled' where "organizationId" = $1`, [acme.id]);
check('a canceled invitation frees its seat', (await seatsUsed(pool, acme.id)) === 1);
const other2 = await signUp('agent3@acme.test', 'Agent Three');
await auth.api.addMember({ body: { userId: other2.user.id, role: 'member', organizationId: acme.id } });
await auth.api.addMember({ body: { userId: other.user.id, role: 'member', organizationId: acme.id } }).then(() => check('a second member fits, a third does not (adding a member is guarded too)', false), e => check('a second member fits, a third does not (adding a member is guarded too)', e.statusCode === 403));

// Paddle
const sign = (body, secret = ENV.PADDLE_WEBHOOK_SECRET, ts = Math.floor(Date.now() / 1000)) => `ts=${ts};h1=${crypto.createHmac('sha256', secret).update(`${ts}:${body}`).digest('hex')}`;
const ev = (over = {}, data = {}) => ({ event_id: 'evt_' + Math.random().toString(36).slice(2), event_type: 'subscription.updated', occurred_at: new Date().toISOString(), data: { id: 'sub_1', status: 'active', customer_id: 'ctm_1', custom_data: { org_id: acme.id }, items: [{ price: { id: 'pri_team_y' }, quantity: 5 }], current_billing_period: { ends_at: '2027-11-09T00:00:00Z' }, ...data }, ...over });
const hook = (e, header) => { const body = JSON.stringify(e); return paddleWebhook(new Request('http://x/api/webhooks/paddle', { method: 'POST', headers: { 'paddle-signature': header === undefined ? sign(body) : header }, body }), deps).then(asJson); };
check('a signature is accepted only when it is right, fresh and made with our secret', verifySignature('{}', sign('{}'), ENV.PADDLE_WEBHOOK_SECRET) && !verifySignature('{}', sign('{}', 'other'), ENV.PADDLE_WEBHOOK_SECRET) && !verifySignature('{ }', sign('{}'), ENV.PADDLE_WEBHOOK_SECRET) && !verifySignature('{}', sign('{}', ENV.PADDLE_WEBHOOK_SECRET, Math.floor(Date.now() / 1000) - 3600), ENV.PADDLE_WEBHOOK_SECRET) && !verifySignature('{}', '', ENV.PADDLE_WEBHOOK_SECRET) && !verifySignature('{}', sign('{}'), ''));
r = await hook(ev(), 'ts=1;h1=abc');
check('the webhook refuses a bad signature (401) and changes nothing', r.status === 401 && (await getEntitlements(pool, acme.id)).plan === 'free');
r = await hook(ev({ event_id: 'evt_a1' }));
check('a good event moves the organization to Team with 5 seats', r.status === 200 && r.body.why === 'applied' && (await getEntitlements(pool, acme.id)).plan === 'team' && (await getEntitlements(pool, acme.id)).seats === 5);
r = await hook(ev({ event_id: 'evt_a1' }));
check('the same event twice is applied once', r.body.why === 'duplicate');
await hook(ev({ event_id: 'evt_old', occurred_at: '2020-01-01T00:00:00Z' }, { items: [{ price: { id: 'pri_team_y' }, quantity: 1 }] }));
check('an older event never overwrites a newer one', (await getEntitlements(pool, acme.id)).seats === 5);
check('the third agent can now be invited, up to the seats paid for', (await invite('agent2@acme.test')).ok);
check('a hook with two items adds their seats and an unknown price is refused politely', (await hook(ev({}, { items: [{ price: { id: 'pri_team_y' }, quantity: 2 }, { price: { id: 'pri_team_y' }, quantity: 3 }] }))).body.why === 'applied' && (await getEntitlements(pool, acme.id)).seats === 5 && (await hook(ev({}, { items: [{ price: { id: 'pri_nope' }, quantity: 3 }] }))).body.why === 'unknown-price');
check('an event for no organization, for an unknown one, or that is not a subscription event is acknowledged without effect', (await hook(ev({}, { custom_data: {} }))).body.why === 'no-org' && (await hook(ev({}, { custom_data: { org_id: 'org_nope' } }))).body.why === 'unknown-org' && (await hook(ev({ event_type: 'transaction.completed' }))).body.why === 'ignored' && (await hook({ nothing: true })).status === 400);
r = await hook(ev({ event_id: 'evt_suite' }, { items: [{ price: { id: 'pri_suite_y' }, quantity: 8 }] }));
check('upgrading to Suite adds its features', (await getEntitlements(pool, acme.id)).features.has('translation') && (await getEntitlements(pool, acme.id)).seats === 8);
await hook(ev({ event_id: 'evt_pd' }, { status: 'past_due', items: [{ price: { id: 'pri_suite_y' }, quantity: 8 }] }));
check('a failed card keeps the plan for now', (await getEntitlements(pool, acme.id)).plan === 'suite');
await hook(ev({ event_id: 'evt_c', event_type: 'subscription.canceled' }, { status: 'canceled' }));
check('after cancellation the organization is back on the free plan, and nobody is removed', (await getEntitlements(pool, acme.id)).plan === 'free' && (await seatsUsed(pool, acme.id)) >= 2 && !(await invite('late@acme.test')).ok);
check('plan changes are audited without card or customer details', (await withOrg(pool, acme.id, c => c.query("select action, meta from audit_log where action = 'plan-changed'"))).rows.length >= 3 && !JSON.stringify((await withOrg(pool, acme.id, c => c.query('select * from audit_log'))).rows).includes('ctm_1'));

// checkout
const co = body => checkout(reqOf(owner, 'POST', '/api/billing/checkout', body), deps).then(asJson);
r = await co({ orgId: acme.id, plan: 'suite', interval: 'year', seats: 10 });
check('an owner gets the checkout details with our organization id attached', r.status === 200 && r.body.priceId === 'pri_suite_y' && r.body.quantity === 10 && r.body.customData.org_id === acme.id && r.body.customerEmail === 'owner@effdesk.test' && r.body.sandbox === true);
check('...but not for fewer seats than people, an unknown price, a bad plan or a bad count', (await co({ orgId: acme.id, plan: 'suite', interval: 'year', seats: 1 })).status === 400 && (await co({ orgId: acme.id, plan: 'suite', interval: 'month', seats: 5 })).status === 400 && (await co({ orgId: acme.id, plan: 'free', interval: 'year', seats: 5 })).status === 400 && (await co({ orgId: acme.id, plan: 'team', interval: 'year', seats: 0 })).status === 400);
check('a person who is not in the organization cannot start its checkout', (await checkout(reqOf(other, 'POST', '/api/billing/checkout', { orgId: acme.id, plan: 'team', interval: 'year', seats: 5 }), deps)).status === 403);
check('nobody signed in: 401', (await checkout(reqOf(null, 'POST', '/api/billing/checkout', {}), deps)).status === 401);

// licence
const lic = (who, method, body) => license(reqOf(who, method, '/api/admin/license', body), deps).then(asJson);
check('only the platform owner can grant a licence', (await lic(other, 'POST', { slug: 'acme' })).status === 403 && (await lic(null, 'POST', { slug: 'acme' })).status === 401);
check('...and only with a verified email', (await lic(owner, 'POST', { slug: 'acme' })).status === 403);
await pool.query(`update "user" set "emailVerified" = true where email = 'owner@effdesk.test'`);
r = await lic(owner, 'POST', { slug: 'acme', note: 'Lifetime licence for mdv' });
check('the owner grants a lifetime licence by slug', r.status === 200 && (await getEntitlements(pool, acme.id)).license === 'lifetime_unlimited' && (await getEntitlements(pool, acme.id)).seats === Infinity);
check('with it, any number of agents can be invited and every feature is on', (await invite('x1@acme.test')).ok && (await invite('x2@acme.test')).ok && (await invite('x3@acme.test')).ok && (await getEntitlements(pool, acme.id)).features.has('sso'));
await hook(ev({ event_id: 'evt_after' }, { status: 'canceled' }));
check('a Paddle cancellation does not touch a licence', (await getEntitlements(pool, acme.id)).license === 'lifetime_unlimited');
check('the licence and its grant are audited', (await withOrg(pool, acme.id, c => c.query("select 1 from audit_log where action = 'license-granted'"))).rowCount === 1);
check('revoking it returns the organization to its subscription (free here)', (await lic(owner, 'DELETE', { slug: 'acme' })).status === 200 && (await getEntitlements(pool, acme.id)).plan === 'free' && (await lic(owner, 'DELETE', { slug: 'acme' })).status === 404);
check('an unknown organization is a 404', (await lic(owner, 'POST', { slug: 'nobody' })).status === 404);

// tenant isolation
await pool.query('drop role if exists rls_tester'); await pool.query('create role rls_tester'); await pool.query('grant select, insert on audit_log to rls_tester'); await pool.query('grant usage on all sequences in schema public to rls_tester');
const asTenant = async (orgId, fn) => { const c = await pool.connect(); try { await c.query('begin'); await c.query('set local role rls_tester'); await c.query("select set_config('app.org_id', $1, true)", [orgId]); const x = await fn(c); await c.query('rollback'); return x; } catch (e) { await c.query('rollback'); return { error: e.message }; } finally { c.release(); } };
await withOrg(pool, beta.id, c => c.query("insert into audit_log (org_id, action) values ($1, 'secret-beta')", [beta.id]));
check('a tenant sees only its own audit rows, even with a query that forgets its WHERE', (await asTenant(acme.id, c => c.query('select action from audit_log'))).rows.every(x => x.action !== 'secret-beta') && (await asTenant(beta.id, c => c.query('select action from audit_log'))).rows.map(x => x.action).join() === 'secret-beta');
check('and cannot write into another tenant', /row-level security/.test((await asTenant(acme.id, c => c.query("insert into audit_log (org_id, action) values ($1, 'x')", [beta.id]))).error || ''));
check('without an organization set, nothing is visible', (await asTenant('', c => c.query('select 1 from audit_log'))).rows.length === 0);
await pool.query('revoke all on audit_log from rls_tester'); await pool.query('revoke all on all sequences in schema public from rls_tester'); await pool.query('drop role rls_tester');

// the sign-in itself
const bad = await auth.handler(new Request('http://localhost:8888/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body: JSON.stringify({ email: 'owner@effdesk.test', password: 'wrong password!' }) }));
check('a wrong password is refused (401) and sets no cookie', bad.status === 401 && !bad.headers.get('set-cookie'));
const good = await auth.handler(new Request('http://localhost:8888/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.8' }, body: JSON.stringify({ email: 'owner@effdesk.test', password: PW }) }));
check('the session cookie is HttpOnly and SameSite=Lax', /HttpOnly/i.test(good.headers.get('set-cookie')) && /SameSite=Lax/i.test(good.headers.get('set-cookie')));
await auth.api.signUpEmail({ body: { email: 'short@x.test', password: 'short', name: 'S' } }).then(() => check('a short password is refused', false), e => check('a short password is refused', e.statusCode === 400));
let limited = 0; for (let i = 0; i < 12; i++) { const x = await auth.handler(new Request('http://localhost:8888/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.9' }, body: JSON.stringify({ email: 'owner@effdesk.test', password: 'nope nope nope' }) })); if (x.status === 429) limited++; }
check('too many sign-in attempts from one address are limited (429)', limited >= 1);
const strict = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: true });
sent.length = 0; await strict.api.signUpEmail({ body: { email: 'new@effdesk.test', password: PW, name: 'New' } });
const unverified = await strict.handler(new Request('http://localhost:8888/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.20' }, body: JSON.stringify({ email: 'new@effdesk.test', password: PW }) }));
check('with verification required, sign-up emails a link and sign-in is refused (403) until it is used', sent.some(m => m.to === 'new@effdesk.test' && /Confirm your email/.test(m.subject)) && unverified.status === 403);
await pool.end(); done();
