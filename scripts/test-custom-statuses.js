// scripts/test-custom-statuses.js: A WORKSPACE'S OWN TICKET STATUSES ON A REAL POSTGRES: error tracking and alerts, browser error reports, health, the status page and its management, per-customer settings and suspension, the announcement banner, the signup switch, user lookup, and the audit log.
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
const mk = async (subject) => (await A(olivia, 'create', { subject, requesterEmail: 'c@x.co', requesterName: 'C', body: 'hi' })).body;
const t1 = (await mk('Broken heater')).number || (await mk('Broken heater')).ticket.number;
const num = t1;
check('a status needs a name and a built-in category', (await A(olivia, 'status-save', { name: '', category: 'open' })).status === 400 && (await A(olivia, 'status-save', { name: 'Waiting', category: 'weird' })).status === 400);
check('a name cannot be a built-in status', (await A(olivia, 'status-save', { name: 'Pending', category: 'open' })).status === 400);
check('agents who are not admins cannot define statuses', (await A(ann, 'status-save', { name: 'Waiting on vendor', category: 'pending' })).status === 403);
const sv = await A(olivia, 'status-save', { name: 'Waiting on vendor', category: 'pending' }); check('an admin can add one', sv.status === 200 && sv.body.ok);
check('two with the same name are refused', (await A(olivia, 'status-save', { name: 'Waiting on vendor', category: 'open' })).status === 409);
const init = (await A(olivia, 'init')).body; check('the desk gets the list', init.statuses.length === 1 && init.statuses[0].category === 'pending');
const sid = sv.body.id;
await A(olivia, 'update', { number: num, patch: { customStatusId: sid } });
let g = (await A(olivia, 'get', { number: num })).body.ticket; check('a ticket in a custom status counts as its category and remembers the name', g.status === 'pending' && String(g.custom_status_id) === String(sid));
check('the timeline names the custom status', (await A(olivia, 'get', { number: num })).body.extras.events.some(e => /Waiting on vendor/.test(e.detail)));
check('the list can be filtered by it', (await A(olivia, 'list', { cstatus: sid })).body.tickets.length === 1 && (await A(olivia, 'list', { status: 'pending' })).body.tickets.length === 1);
await A(olivia, 'update', { number: num, patch: { status: 'open' } }); g = (await A(olivia, 'get', { number: num })).body.ticket; check('choosing a built-in status clears the custom one', g.status === 'open' && g.custom_status_id === null);
await A(olivia, 'update', { number: num, patch: { customStatusId: sid } });
await A(olivia, 'status-save', { id: sid, name: 'Waiting on vendor', category: 'solved' }); g = (await A(olivia, 'get', { number: num })).body.ticket; check('changing a status’s category moves its tickets with it', g.status === 'solved' && g.solved_at);
check('an unknown custom status is refused', (await A(olivia, 'update', { number: num, patch: { customStatusId: 99999 } })).status === 400);
await A(olivia, 'status-delete', { id: sid }); g = (await A(olivia, 'get', { number: num })).body.ticket; check('deleting one keeps the tickets, in their category, with no custom name', g.status === 'solved' && g.custom_status_id === null);
done();
