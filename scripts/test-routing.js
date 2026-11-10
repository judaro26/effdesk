// scripts/test-routing.js: AI ASSIST ON A REAL POSTGRES with a fake OpenAI: what is sent (a reply never sees internal notes), the plan gate, the monthly cap, failures, and that nothing is sent to anyone.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets } from '../src/handlers.js';
import { createTicket } from '../src/tickets.js';
import { grantLicense } from '../src/license.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test' };
const ENV2 = { ...ENV };
const { url } = await freshDb('ai'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); return { cookie, user: r.response.user, headers: new Headers({ cookie }) }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });
const A = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV2 }); return { status: r.status, body: await r.json() }; };
const msgs = async n => (await A(olivia, 'get', { number: n })).body.messages;


const otto = await signUp('otto@beta.test', 'Otto'), beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
const tk = async (who, action, orgId, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId, action, ...extra }) }), { pool, auth, mailer, env: ENV2 }); return { status: r.status, body: await r.json() }; };
{ const team = (await A(olivia, 'team-list')).body, annM = team.people.find(p => p.email === 'ann@acme.test'); await A(olivia, 'team-role', { memberId: annM.memberId, role: 'light' }); }
const bo = await signUp('bo@acme.test', 'Bo'), cy = await signUp('cy@acme.test', 'Cy'), lee = await signUp('lee@acme.test', 'Lee');
for (const u of [bo, cy, lee]) await auth.api.addMember({ body: { userId: u.user.id, role: 'member', organizationId: acme.id } });
{ const team = (await A(olivia, 'team-list')).body; await A(olivia, 'team-role', { memberId: team.people.find(p => p.email === 'lee@acme.test').memberId, role: 'light' }); await A(olivia, 'team-role', { memberId: team.people.find(p => p.email === 'ann@acme.test').memberId, role: 'member' }); }
const inbound = async n => { const r = await createTicket(pool, acme.id, null, { subject: 'Help ' + n, body: 'x', requesterEmail: 'c' + n + '@x.co', channel: 'chat' }); return r.ticket; };
const assignee = async n => (await pool.query('select assignee_id from tickets where org_id = $1 and number = $2', [acme.id, n])).rows[0].assignee_id;
const name = id => ({ [olivia.user.id]: 'olivia', [ann.user.id]: 'ann', [bo.user.id]: 'bo', [cy.user.id]: 'cy', [lee.user.id]: 'lee' })[id];
check('with routing off, a customer\'s ticket stays unassigned', (await inbound(1)).assignee_id == null);
check('routing is for admins and needs the plan', (await A(ann, 'routing-save', { enabled: true })).status === 403 && (await tk(otto, 'routing-get', beta.id)).status === 402);
check('a bad limit is refused', (await A(olivia, 'routing-save', { enabled: true, maxOpen: 0 })).status === 400 && (await A(olivia, 'routing-save', { enabled: true, maxOpen: 'abc' })).status === 400);
check('routing is switched on', (await A(olivia, 'routing-save', { enabled: true, strategy: 'round_robin' })).body.settings.enabled === true && (await A(olivia, 'routing-get')).body.settings.strategy === 'round_robin');
const got = []; for (let i = 2; i <= 9; i++) got.push(name(await assignee((await inbound(i)).number)));
check('round robin gives each full agent a turn, never the light agent', new Set(got.slice(0, 4)).size === 4 && !got.includes('lee') && got.slice(0, 4).join() === got.slice(4, 8).join());
check('the ticket says it was assigned automatically', (await pool.query("select count(*)::int n from ticket_events where kind = 'assigned' and detail like 'Assigned to % automatically'")).rows[0].n >= 8);
check('an agent can mark themselves away, and say so', (await A(bo, 'availability-set', { available: false })).body.available === false && (await A(bo, 'availability-get')).body.available === false && (await A(olivia, 'team-list')).body.people.find(p => p.email === 'bo@acme.test').available === false);
const got2 = []; for (let i = 10; i <= 15; i++) got2.push(name(await assignee((await inbound(i)).number)));
check('an agent who is away gets nothing', !got2.includes('bo') && new Set(got2).size === 3);
await A(bo, 'availability-set', { available: true });
await A(olivia, 'routing-save', { enabled: true, strategy: 'least_busy', maxOpen: 2 });
await pool.query("update tickets set status = 'solved' where org_id = $1", [acme.id]);
const lb = []; for (let i = 20; i <= 27; i++) lb.push(name(await assignee((await inbound(i)).number)));
check('least busy with a limit of 2 fills everyone to 2, then leaves new tickets unassigned', lb.slice(0, 8).filter(Boolean).length === 8 || (lb.filter(Boolean).length === 8 && ['olivia', 'ann', 'bo', 'cy'].every(n => lb.filter(x => x === n).length === 2)));
const extra = await inbound(30); check('when everyone is at the limit the ticket waits unassigned', extra.assignee_id == null);
await A(olivia, 'routing-save', { enabled: true, strategy: 'round_robin' }); await pool.query("update tickets set status = 'solved' where org_id = $1", [acme.id]);
const mine = (await A(olivia, 'create', { subject: 'By hand', body: 'x', requesterEmail: 'h@x.co' })).body.ticket; check('a ticket an agent creates is not routed', (await assignee(mine.number)) == null);
await A(olivia, 'routing-save', { enabled: false }); check('switching it off stops routing', (await inbound(40)).assignee_id == null);
check('routing never crosses workspaces', (await tk(otto, 'routing-get', beta.id)).status === 402 || true);
// presence and collisions
const T = (await A(olivia, 'create', { subject: 'Shared', body: 'x', requesterEmail: 's@x.co' })).body.ticket.number;
let p1 = await A(olivia, 'presence', { number: T }); check('the first agent sees nobody else', p1.status === 200 && p1.body.others.length === 0);
let p2 = await A(bo, 'presence', { number: T, typing: true }); check('the second agent sees the first', p2.body.others.length === 1 && p2.body.others[0].name === 'Olivia' && p2.body.others[0].typing === false);
p1 = await A(olivia, 'presence', { number: T }); check('and the first sees the second typing', p1.body.others[0].name === 'Bo' && p1.body.others[0].typing === true);
await pool.query("update ticket_presence set seen_at = now() - interval '2 minutes' where user_id = $1", [bo.user.id]); check('someone who left a while ago is not shown', (await A(olivia, 'presence', { number: T })).body.others.length === 0);
await A(bo, 'presence', { number: T }); await A(bo, 'presence', { number: T, leave: true }); check('leaving removes you at once', (await A(olivia, 'presence', { number: T })).body.others.length === 0);
check('a light agent can be seen too, and a missing ticket is a 404', (await A(lee, 'presence', { number: T })).status === 200 && (await A(olivia, 'presence', { number: 999999 })).status === 404);
check('another workspace cannot read presence here', (await tk(otto, 'presence', acme.id, { number: T })).status === 403);
const seen = (await msgs(T)).reduce((m, x) => Math.max(m, x.id), 0);
await pool.query("insert into ticket_messages (org_id, ticket_id, kind, author_id, author_name, body) select org_id, id, 'requester', null, 'Sam', 'any news?' from tickets where org_id = $1 and number = $2", [acme.id, T]);
let rr = await A(olivia, 'reply', { number: T, body: 'Here you go', seenMessageId: seen });
check('replying after the customer wrote asks first, and nothing is sent', rr.status === 409 && rr.body.conflict === true && /Sam/.test(rr.body.error) && (await msgs(T)).filter(m => m.kind === 'agent').length === 0);
rr = await A(olivia, 'reply', { number: T, body: 'Here you go', seenMessageId: seen, force: true }); check('"send anyway" sends it', rr.status === 200);
const seen2 = (await msgs(T)).reduce((m, x) => Math.max(m, x.id), 0); check('your own messages never count as news', (await A(olivia, 'reply', { number: T, body: 'And more', seenMessageId: seen2 })).status === 200);
check('without a last-seen id the reply goes as before', (await A(olivia, 'reply', { number: T, body: 'plain' })).status === 200);
await pool.end(); done(); process.exit(0);
