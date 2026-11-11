// scripts/test-platform-admin.js: THE PLATFORM OWNER'S TOOLS ON A REAL POSTGRES: error tracking and alerts, browser error reports, health, the status page and its management, per-customer settings and suspension, the announcement banner, the signup switch, user lookup, and the audit log.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets, adminDo, clientLog, health, statusPublic, me, signup } from '../src/handlers.js';
import { recordError, fingerprint } from '../src/errors.js';
import { logged, sinks } from '../src/log.js';
import { resetCache } from '../src/platform-settings.js';
import { createTicket } from '../src/tickets.js';
import { grantLicense } from '../src/license.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
process.env.PLATFORM_ADMIN_EMAILS = 'boss@effdesk.test';
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

const boss = await signUp('boss@effdesk.test', 'Boss');
await pool.query('update "user" set "emailVerified" = true where email = $1', ['boss@effdesk.test']);
const boss2 = { ...boss, user: { ...boss.user } };
const D = async (who, action, extra = {}) => { const r = await adminDo(new Request('http://x/api/admin/do', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
check('only the platform owner can use the console', (await D(olivia, 'system')).status === 403);
check('the owner can', (await D(boss, 'system')).status === 200);

const A = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
// ---- error tracking
const mails = () => outbox.filter(m => /EffDesk (new error|error is back|error still)/.test(m.subject || ''));
const e1 = { fn: 'tickets', name: 'TypeError', message: 'Cannot read properties of undefined (reading \'id\') for ticket 4411', stack: 'TypeError: x\n    at handler (file:///var/task/src/handlers.js:100:5)', path: '/api/tickets', status: 500, request_id: 'req1' };
const sameKind = { ...e1, message: 'Cannot read properties of undefined (reading \'id\') for ticket 9', request_id: 'req2' };
check('the same failure has the same fingerprint whatever the numbers in it', fingerprint(e1) === fingerprint(sameKind) && fingerprint(e1) !== fingerprint({ ...e1, fn: 'other' }));
const r1 = await recordError(pool, mailer, process.env, e1);
check('a new kind of error is recorded and the owner is emailed', r1.first && r1.alerted && (outbox.some(m => /new error: TypeError/.test(m.subject || '') && String(m.to).includes('boss@effdesk.test') || (m.subject || '').includes('new error'))));
const nBefore = outbox.length;
for (let i = 0; i < 5; i++) await recordError(pool, mailer, process.env, sameKind);
check('the same error 5 more times is one row with a count and no more emails', (await pool.query('select count from error_events')).rows[0].count === 6 && (await pool.query('select count(*)::int n from error_events')).rows[0].n === 1 && outbox.length === nBefore);
await pool.query("update error_events set last_alerted_at = now() - interval '2 hours'");
await recordError(pool, mailer, process.env, sameKind);
check('still happening an hour later: one more email', outbox.length === nBefore + 1);
const list = await D(boss, 'errors'); const eid = list.body.errors[0].id;
check('the console lists it with its count, request id and stack', list.body.errors.length === 1 && list.body.errors[0].count === 7 && list.body.errors[0].request_id === 'req2' && /handlers\.js/.test(list.body.errors[0].stack) && list.body.summary.open === 1);
await D(boss, 'error-resolve', { id: eid, resolved: true });
check('resolved errors leave the open list', (await D(boss, 'errors')).body.errors.length === 0 && (await D(boss, 'errors', { state: 'resolved' })).body.errors.length === 1);
const nb2 = outbox.length; await recordError(pool, mailer, process.env, sameKind);
const back = (await D(boss, 'errors')).body.errors;
check('a resolved error that comes back is reopened and emailed', back.length === 1 && outbox.length === nb2 + 1 && /error is back/.test(outbox[outbox.length - 1].subject));
check('the test button records an error and emails', (await D(boss, 'error-test')).body.alerted === true);

// ---- the logged() wrapper hands failures to the tracker
sinks.onError = e => recordError(pool, mailer, process.env, e);
const boom = logged('boom-fn', async () => { throw new Error('kaboom 77'); });
const res = await boom(new Request('http://x/api/boom'), {});
check('a crashing function answers 500 with a request id', res.status === 500 && !!res.headers.get('x-request-id'));
const bo = (await pool.query("select * from error_events where fn = 'boom-fn'")).rows;
check('and the crash is tracked with the same request id', bo.length === 1 && bo[0].message === 'kaboom 77' && bo[0].request_id === res.headers.get('x-request-id'));
const five = logged('five-fn', async () => new Response('no', { status: 503 })); await five(new Request('http://x/api/five'), {});
check('a 5xx answer without a crash is tracked too', (await pool.query("select 1 from error_events where fn = 'five-fn' and name = 'HTTP 503'")).rowCount === 1);
const ok200 = logged('fine-fn', async () => new Response('ok')); await ok200(new Request('http://x/api/fine'), {});
check('a normal answer tracks nothing', (await pool.query("select 1 from error_events where fn = 'fine-fn'")).rowCount === 0);
sinks.onError = null;

// ---- browser error reports
const cl = (body) => clientLog(new Request('http://x/api/client-log', { method: 'POST', body: JSON.stringify(body) }), { pool, mailer, env: ENV });
check('a browser error is recorded with its page', (await cl({ name: 'TypeError', message: 'x is not a function', stack: 'at a (desk.js:1:1)', page: '/desk.html?org=abc' })).status === 200 && (await pool.query("select path from error_events where source = 'browser'")).rows[0].path === '/desk.html');
check('an empty report is refused', (await cl({ message: '' })).status === 400);
check('a huge report is refused', (await clientLog(new Request('http://x/api/client-log', { method: 'POST', body: 'x'.repeat(5000) }), { pool, mailer, env: ENV })).status === 413);
await pool.query("insert into error_events (fingerprint, source, fn, name, message) select 'flood' || g, 'browser', 'browser', 'E', 'm' || g from generate_series(1, 100) g");
const before = (await pool.query('select count(*)::int n from error_events')).rows[0].n; await cl({ name: 'New', message: 'a brand new kind of failure' });
check('strangers cannot flood the tracker with new kinds (100 a day)', (await pool.query('select count(*)::int n from error_events')).rows[0].n === before);
await pool.query("delete from error_events where fingerprint like 'flood%'");

// ---- health
const h = await health(new Request('http://x/api/health'), { pool, env: ENV }); const hj = await h.json();
check('health says the database is up', h.status === 200 && hj.ok && hj.db);

// ---- logging test
sinks.fetch = async (u, o) => ({ ok: true, status: 200 });
const lt = await D(boss, 'logging-test');
check('the logging test sends a line to Axiom and says what Axiom answered', lt.body.configured && lt.body.results[0].sink === 'axiom' && lt.body.results[0].ok && lt.body.results[0].status === 200);
sinks.fetch = async () => ({ ok: false, status: 401 }); const lt2 = await D(boss, 'logging-test');
check('and says when it is refused', lt2.body.results[0].ok === false && lt2.body.results[0].status === 401);
check('the console reports what is set up without showing the token', (await D(boss, 'logging')).body.logging.axiom.dataset === 'effdesk' && !JSON.stringify((await D(boss, 'logging')).body).includes('xaat-test'));
sinks.fetch = (...a) => fetch(...a);

// ---- the status page
const S = async (path) => statusPublic(new Request('http://x' + path), { pool, env: ENV });
let pg = await (await S('/status')).text();
check('the status page starts with everything operational', /All systems operational/.test(pg) && /Help desk and agent app/.test(pg) && /90 days ago/.test(pg));
const comps = (await D(boss, 'status-list')).body.components; const api = comps.find(c => /API/.test(c.name)), desk = comps[0];
check('an incident needs a title and a first update', (await D(boss, 'status-incident-create', { title: '', body: 'x' })).status === 400 && (await D(boss, 'status-incident-create', { title: 'Slow', body: '' })).status === 400);
const inc = await D(boss, 'status-incident-create', { title: 'API <b>errors</b>', impact: 'major', status: 'investigating', componentIds: [api.id], body: 'We are looking into it.' });
pg = await (await S('/status')).text();
check('an open incident shows with its update, and its component turns to partial outage', inc.status === 200 && /Current incidents/.test(pg) && /API &lt;b&gt;errors&lt;\/b&gt;/.test(pg) && /We are looking into it/.test(pg) && /Partial outage/.test(pg) && /Some systems are not working/.test(pg));
check('text is escaped, never drawn as HTML', !/<b>errors<\/b>/.test(pg));
await D(boss, 'status-incident-update', { id: inc.body.id, status: 'identified', impact: 'critical', body: 'A bad deploy. Rolling back.' });
pg = await (await S('/status')).text(); check('an update with a worse impact makes it a major outage and lists both updates', /Major outage/.test(pg) && /Rolling back/.test(pg) && /We are looking into it/.test(pg));
const js = await (await S('/api/status')).json();
check('the JSON says what is wrong, for other tools', js.status.indicator === 'critical' && js.components.find(c => c.id === api.id).status === 'major_outage' && js.incidents.length === 1 && js.incidents[0].updates.length === 2);
check('the JSON can be read from any website', (await S('/api/status')).headers.get('access-control-allow-origin') === '*');
const feed = await (await S('/status/feed.xml')).text(); check('the feed has an entry per update', /<feed/.test(feed) && (feed.match(/<entry>/g) || []).length === 2 && /Rolling back/.test(feed));
check('an incident has its own page', /Rolling back/.test(await (await S('/status/incidents/' + inc.body.id)).text()) && (await S('/status/incidents/99999')).status === 404);
await D(boss, 'status-incident-update', { id: inc.body.id, status: 'resolved', body: 'Fixed.' });
pg = await (await S('/status')).text();
check('resolving it clears the banner and moves it to past incidents', /All systems operational/.test(pg) && !/Current incidents/.test(pg) && /Past incidents/.test(pg) && /Fixed\./.test(pg));
await pool.query("update status_incidents set started_at = now() - interval '3 hours', resolved_at = now() - interval '1 hour' where id = $1", [inc.body.id]);
const upt = (await (await S('/api/status')).json()).components.find(c => c.id === api.id).uptime_90d; check('uptime drops for the time of a major outage', upt < 100 && upt > 99.9);
const soon = new Date(Date.now() + 2 * 3600e3).toISOString(), later = new Date(Date.now() + 3 * 3600e3).toISOString();
check('maintenance needs a start and an end after it', (await D(boss, 'status-incident-create', { kind: 'maintenance', title: 'DB upgrade', body: 'x' })).status === 400 && (await D(boss, 'status-incident-create', { kind: 'maintenance', title: 'DB upgrade', body: 'x', scheduledFor: later, scheduledUntil: soon })).status === 400);
const mt = await D(boss, 'status-incident-create', { kind: 'maintenance', title: 'Database upgrade', body: 'Short read-only period.', scheduledFor: soon, scheduledUntil: later, componentIds: [desk.id] });
pg = await (await S('/status')).text(); check('upcoming maintenance is listed and does not change the banner', /Planned maintenance/.test(pg) && /Database upgrade/.test(pg) && /All systems operational/.test(pg));
const nowStart = new Date(Date.now() - 600e3).toISOString(); await D(boss, 'status-incident-create', { kind: 'maintenance', title: 'Right now', body: 'Under way.', scheduledFor: nowStart, scheduledUntil: later, componentIds: [desk.id] });
pg = await (await S('/status')).text(); check('maintenance that has started shows the component as under maintenance', /Under maintenance/.test(pg) && /Scheduled maintenance in progress/.test(pg));
await D(boss, 'status-component-save', { id: api.id, name: api.name, description: api.description, status: 'degraded', position: api.position, visible: true });
check('a component can be set by hand', /Degraded performance/.test(await (await S('/status')).text()));
const nc = await D(boss, 'status-component-save', { name: 'Billing', description: 'Paddle checkout', status: 'operational' });
check('components can be added and hidden', nc.status === 200 && /Billing/.test(await (await S('/status')).text()) && (await D(boss, 'status-component-save', { id: nc.body.id, name: 'Billing', status: 'operational', visible: false })).status === 200 && !/Billing/.test(await (await S('/status')).text()));
check('a component needs a name', (await D(boss, 'status-component-save', { name: ' ' })).status === 400);
await D(boss, 'status-incident-delete', { id: mt.body.id }); check('an incident can be deleted', (await S('/status/incidents/' + mt.body.id)).status === 404);
check('an unknown path is a 404 and POST is refused', (await S('/status/nope')).status === 404 && (await statusPublic(new Request('http://x/status', { method: 'POST' }), { pool, env: ENV })).status === 405);

// ---- one customer's settings
const cg = await D(boss, 'customer-get', { slug: 'acme' });
check('a customer\'s settings show the plan and the effective features', cg.status === 200 && cg.body.effective.plan === 'pro' && cg.body.allFeatures.includes('whatsapp'));
check('limits must be numbers', (await D(boss, 'customer-save', { slug: 'acme', seatLimit: 'many' })).status === 400);
await D(boss, 'customer-save', { slug: 'acme', seatLimit: 7, mailPerDay: 9000, storageMb: 123, aiMonthly: 5, featuresOff: ['whatsapp', 'bogus'], note: 'Friendly customer' });
const eff = (await D(boss, 'customer-get', { slug: 'acme' })).body;
check('overrides change the seats and switch a feature off', eff.effective.seats === 7 && !eff.effective.features.includes('whatsapp') && eff.effective.features.includes('sso') && eff.overrides.note === 'Friendly customer' && eff.overrides.features_off.length === 1);
check('and the product obeys them: WhatsApp is now refused with 402', (await A(olivia, 'whatsapp-templates')).status === 402);
const { mailLimit } = await import('../src/plans.js'); const { getEntitlements } = await import('../src/billing.js'); const entA = await getEntitlements(pool, acme.id);
check('the mail limit and storage follow too', mailLimit(entA) === 9000 && entA.storageBytes === 123 * 1048576 && entA.aiMonthly === 5);
await D(boss, 'customer-save', { slug: 'acme', featuresOn: ['whatsapp'] });
check('clearing a limit puts the plan\'s back, and a feature can be switched on', (await A(olivia, 'whatsapp-templates')).status === 200 && (await getEntitlements(pool, acme.id)).seats === Infinity);
check('a suspension needs a reason', (await D(boss, 'customer-suspend', { slug: 'acme', suspended: true })).status === 400);
await D(boss, 'customer-suspend', { slug: 'acme', suspended: true, reason: 'Payment dispute' });
const sus = await A(olivia, 'list'); check('a suspended workspace is refused with the reason', sus.status === 403 && sus.body.suspended === true && /Payment dispute/.test(sus.body.error));
await D(boss, 'customer-suspend', { slug: 'acme', suspended: false }); check('and works again when restored', (await A(olivia, 'list')).status === 200);

// ---- announcement and signups
resetCache(); const meOf = async who => (await (await me(new Request('http://x/api/me', { headers: { cookie: who.cookie } }), { pool, auth, env: ENV })).json());
check('no banner by default', (await meOf(olivia)).banner === null);
check('an announcement needs text', (await D(boss, 'settings-save', { announcement: { active: true, text: '' } })).status === 400);
await D(boss, 'settings-save', { announcement: { active: true, text: 'Maintenance tonight at 10pm UTC', tone: 'warn', link: 'https://effdesk.com/status' } });
const bn = (await meOf(olivia)).banner; check('every desk gets the banner', bn && bn.text === 'Maintenance tonight at 10pm UTC' && bn.tone === 'warn' && bn.link === 'https://effdesk.com/status');
await D(boss, 'settings-save', { announcement: { active: true, text: 'x', tone: 'weird', link: 'javascript:alert(1)' } }); const bn2 = (await meOf(olivia)).banner; check('a bad tone or a non-https link is dropped', bn2.tone === 'info' && bn2.link === '');
await D(boss, 'settings-save', { announcement: { active: false, text: 'x' } }); check('switching it off removes it', (await meOf(olivia)).banner === null);
const su = body => signup(new Request('http://x/api/signup', { method: 'POST', body: JSON.stringify(body) }), { pool, auth, env: ENV });
await D(boss, 'settings-save', { signups: { open: false, message: 'Back on Monday.' } });
const closed = await su({ company: 'Zed Co', slug: 'zedco', name: 'Z', email: 'z@zed.test', password: PW }); const cj = await closed.json();
check('with signups paused a new workspace is refused with the owner\'s message', closed.status === 403 && cj.code === 'SIGNUPS_PAUSED' && cj.message === 'Back on Monday.');
await D(boss, 'settings-save', { signups: { open: true } });

// ---- people
check('searching people needs two characters', (await D(boss, 'user-search', { q: 'o' })).status === 400);
const us = await D(boss, 'user-search', { q: 'OLIVIA' }); const ou = us.body.users[0];
check('a person is found with their workspaces and sessions', ou.email === 'olivia@acme.test' && ou.orgs[0].slug === 'acme' && ou.orgs[0].role === 'owner' && ou.sessions >= 1);
const so = await D(boss, 'user-signout', { userId: ou.id }); check('signing someone out ends their sessions', so.body.signedOut >= 1 && (await A(olivia, 'list')).status === 401);
await pool.query('update "user" set "emailVerified" = false where email = $1', ['ann@acme.test']); const ann2 = (await D(boss, 'user-search', { q: 'ann@' })).body.users[0]; await D(boss, 'user-verify', { userId: ann2.id });
check('an address can be marked verified', (await pool.query('select "emailVerified" v from "user" where email = $1', ['ann@acme.test'])).rows[0].v === true);

// ---- audit
const au = (await D(boss, 'audit-list')).body.entries;
check('what the owner did is in the audit log with who and to what', au.some(e => e.action === 'customer.suspend' && e.target === 'acme' && e.actor === 'boss@effdesk.test') && au.some(e => e.action === 'status-incident-create') && au.some(e => e.action === 'user.signout'));
check('the audit log never has the suspension note text of other fields it should not', !JSON.stringify(au).includes('Friendly customer'));
done();
