// scripts/test-workspace-status.js: A WORKSPACE'S OWN PUBLIC STATUS PAGE ON A REAL POSTGRES: error tracking and alerts, browser error reports, health, the status page and its management, per-customer settings and suspension, the announcement banner, the signup switch, user lookup, and the audit log.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { helpCenter, tickets, adminDo, clientLog, health, statusPublic, me, signup } from '../src/handlers.js';
import { recordError, fingerprint } from '../src/errors.js';
import { logged, sinks } from '../src/log.js';
import { resetCache } from '../src/platform-settings.js';
import { createTicket } from '../src/tickets.js';
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

const P = async (path) => helpCenter(new Request('https://x.test' + path), { pool, auth, mailer, env: ENV });
const bob = await signUp('bob@other.test', 'Bob'); const other = await auth.api.createOrganization({ body: { name: 'Other Co', slug: 'otherco' }, headers: bob.headers });
await grantLicense(pool, { orgId: other.id, actorEmail: 'owner@effdesk.test', note: 'test' });
const B = async (who, org, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: org.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
check('with nothing set up the page says all systems operational and that nothing is listed', await (await P('/help/acme/status')).text().then(t => /Acme status/.test(t) && /All systems operational/.test(t) && /No systems are listed yet/.test(t)));
check('only admins can manage it', (await A(ann, 'wstatus-list')).status === 403 && (await A(olivia, 'wstatus-list')).status === 200);
const c1 = await A(olivia, 'wstatus-component-save', { name: 'Customer portal', description: 'Where you track requests', status: 'operational' }); check('an admin adds a system', c1.status === 200);
check('a system needs a name', (await A(olivia, 'wstatus-component-save', { name: '' })).status === 400);
const inc = await A(olivia, 'wstatus-incident-create', { title: 'Portal <i>slow</i>', impact: 'major', body: 'We are on it.', componentIds: [c1.body.id] }); check('and posts an incident', inc.status === 200);
let pg = await (await P('/help/acme/status')).text();
check('the public page shows it, escaped, with the system as a partial outage, with the help-center header and no platform branding links', /Portal &lt;i&gt;slow&lt;\/i&gt;/.test(pg) && /Partial outage/.test(pg) && /We are on it/.test(pg) && /href="\/help\/acme"/.test(pg) && !/Sign in/.test(pg) && /Powered by/.test(pg));
const js = await (await P('/help/acme/status/json')).json(); check('JSON works for the workspace', js.page.name === 'Acme' && js.status.indicator === 'major' && js.components[0].name === 'Customer portal');
check('the feed and incident page live under the workspace', /\/help\/acme\/status\/incidents\//.test(await (await P('/help/acme/status/feed.xml')).text()) && /We are on it/.test(await (await P('/help/acme/status/incidents/' + inc.body.id)).text()));
check('the platform page is not affected', !/Portal/.test(await (await statusPublic(new Request('http://x/status'), { pool, env: ENV })).text()) && !/Acme/.test(await (await statusPublic(new Request('http://x/api/status'), { pool, env: ENV })).text()));
// isolation: another workspace sees nothing and can touch nothing of Acme's
pg = await (await P('/help/otherco/status')).text(); check('another workspace’s page shows none of it', /All systems operational/.test(pg) && !/Portal/.test(pg));
check('another workspace cannot see Acme’s incident under its own address', (await P('/help/otherco/status/incidents/' + inc.body.id)).status === 404);
check('nor change or delete it', (await B(bob, other, 'wstatus-incident-update', { id: inc.body.id, status: 'resolved', body: 'hacked' })).status === 404 && (await B(bob, other, 'wstatus-component-delete', { id: c1.body.id })).status === 404 && (await B(bob, other, 'wstatus-component-save', { id: c1.body.id, name: 'Mine now', status: 'operational' })).status === 404 && (await B(bob, other, 'wstatus-incident-delete', { id: inc.body.id })).status === 200);
check('(and after that attempt Acme still has it)', (await A(olivia, 'wstatus-list')).body.incidents.length === 1 && (await A(olivia, 'wstatus-list')).body.components[0].name === 'Customer portal');
const oc = await B(bob, other, 'wstatus-component-save', { name: 'Theirs', status: 'operational' }); const own = await B(bob, other, 'wstatus-incident-create', { title: 'X', body: 'y', componentIds: [c1.body.id, oc.body.id] });
check('an incident can only name its own workspace’s systems', (await B(bob, other, 'wstatus-list')).body.incidents[0].component_ids.map(String).join() === String(oc.body.id));
await A(olivia, 'wstatus-incident-update', { id: inc.body.id, status: 'resolved', body: 'Fixed.' }); pg = await (await P('/help/acme/status')).text(); check('resolving brings it back to operational and moves it to past incidents', /All systems operational/.test(pg) && /Past incidents/.test(pg) && /Fixed\./.test(pg));
check('an unknown workspace is a 404', (await P('/help/nobody/status')).status === 404);
await pool.query("delete from org_overrides where org_id = $1", [acme.id]); 
done();
