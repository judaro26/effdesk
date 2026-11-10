// scripts/test-roles.js: AI ASSIST ON A REAL POSTGRES with a fake OpenAI: what is sent (a reply never sees internal notes), the plan gate, the monthly cap, failures, and that nothing is sent to anyone.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets } from '../src/handlers.js';
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
const bo = await signUp('bo@acme.test', 'Bo'); await auth.api.addMember({ body: { userId: bo.user.id, role: 'member', organizationId: acme.id } });
const T = (await A(olivia, 'create', { subject: 'Leak', body: 'Water!', requesterEmail: 'tina@example.com' })).body.ticket.number;
const people = async () => (await A(olivia, 'roles-list')).body;
check('the free plan has no custom roles, audit log or data export', (await tk(otto, 'roles-list', beta.id)).status === 402 && (await tk(otto, 'audit-list', beta.id)).status === 402 && (await tk(otto, 'export-info', beta.id)).status === 402);
check('only admins manage roles', (await A(bo, 'roles-list')).status === 403 && (await A(bo, 'audit-list')).status === 403 && (await A(bo, 'export-data')).status === 403);
check('unknown permissions and empty names are refused', (await A(olivia, 'role-save', { name: 'X', permissions: ['rule-the-world'] })).status === 400 && (await A(olivia, 'role-save', { name: ' ', permissions: [] })).status === 400);
let r = await A(olivia, 'role-save', { name: 'Tier 1', permissions: ['reply', 'labels'] }); const roleId = r.body.id;
check('a role is created and shows in the list with the permissions it can grant', r.status === 200 && (await people()).roles[0].name === 'Tier 1' && (await people()).perms.length >= 10);
check('a duplicate name is refused', (await A(olivia, 'role-save', { name: 'Tier 1', permissions: [] })).status === 400);
const bu = (await people()).people.find(p => p.email === 'bo@acme.test').userId, ou = (await people()).people.find(p => p.email === 'olivia@acme.test').userId;
check('a role cannot be given to an owner', (await A(olivia, 'role-assign', { userId: ou, roleId })).status === 400);
check('a role is given to a full agent', (await A(olivia, 'role-assign', { userId: bu, roleId })).body.role === 'Tier 1' && (await people()).people.find(p => p.userId === bu).customRoleId === roleId);
check('init tells the desk what the agent may do', (await A(bo, 'init')).body.perms.join() === 'reply,labels' && (await A(bo, 'init')).body.customRole === 'Tier 1' && (await A(olivia, 'init')).body.perms === null);
check('the agent can do what the role allows', (await A(bo, 'reply', { number: T, body: 'On it' })).status === 200 && (await A(bo, 'labels', { number: T, add: ['x'] })).status !== 403);
check('the agent is refused what the role does not allow, with the role named', (await A(bo, 'update', { number: T, patch: { status: 'solved' } })).status === 403 && /Tier 1/.test((await A(bo, 'update', { number: T, patch: { status: 'solved' } })).body.error) && (await A(bo, 'bulk', { numbers: [T], patch: { status: 'solved' } })).status === 403 && (await A(bo, 'merge', { number: T, into: 1 })).status === 403);
check('reading and internal notes always work', (await A(bo, 'get', { number: T })).status === 200 && (await A(bo, 'note', { number: T, body: 'fyi' })).status === 200 && (await A(bo, 'list')).status === 200);
check('the status did not change', (await A(olivia, 'get', { number: T })).body.ticket.status !== 'solved');
await A(olivia, 'role-save', { id: roleId, name: 'Tier 1', permissions: ['reply', 'status'] });
check('editing the role takes effect at once', (await A(bo, 'update', { number: T, patch: { status: 'solved' } })).status === 200);
await A(olivia, 'role-assign', { userId: bu, roleId: null });

check('removing the role gives the agent full access again', (await A(bo, 'bulk', { numbers: [T], patch: { priority: 'low' } })).status === 200);
await A(olivia, 'role-assign', { userId: bu, roleId }); await A(olivia, 'role-delete', { id: roleId });
check('deleting a role frees the people who had it', (await A(bo, 'bulk', { numbers: [T], patch: { priority: 'high' } })).status === 200 && (await people()).roles.length === 0);
check('another workspace cannot use or see these roles', (await tk(otto, 'role-assign', acme.id, { userId: bu, roleId })).status === 403);
// audit log
await A(olivia, 'queue-save', { name: 'Billing' }); await A(olivia, 'macro-delete', { id: 999999 });
r = await A(olivia, 'audit-list'); const acts = r.body.entries.map(e => e.action);
check('settings changes are in the audit log with who made them', r.status === 200 && acts.includes('queue-save') && acts.includes('role-save') && acts.includes('role-assign') && r.body.entries[0].actor === 'olivia@acme.test');
check('a failed change is not logged', !acts.includes('macro-delete') || r.body.entries.filter(e => e.action === 'macro-delete').length === 0);
check('the newest entry comes first', r.body.entries.every((e, i, a) => !i || a[i - 1].id > e.id));
r = await A(olivia, 'audit-list', { filter: 'role-', limit: 2 }); check('the log can be filtered by action and paged', r.body.entries.length === 2 && r.body.entries.every(e => e.action.startsWith('role-')) && (r.body.next === null || (await A(olivia, 'audit-list', { filter: 'role-', limit: 50, before: r.body.next })).body.entries.every(e => e.id < r.body.next)));
check('filtering by person works', (await A(olivia, 'audit-list', { actor: 'olivia' })).body.entries.length > 0 && (await A(olivia, 'audit-list', { actor: 'nobody-here' })).body.entries.length === 0);
r = await A(olivia, 'audit-csv'); check('the log downloads as a CSV with a header', r.status === 200 && /^at,actor,action,target,details/.test(r.body.csv) && /queue-save/.test(r.body.csv) && /\.csv$/.test(r.body.filename));
// data export
const info = (await A(olivia, 'export-info')).body; check('the export says how many parts there are', info.tickets >= 1 && info.parts === 1);
r = await A(olivia, 'export-data', { part: 1 }); const ex = JSON.parse(r.body.json);
check('the export holds tickets with their messages, clients, macros, queues and articles', ex.tickets.length === info.tickets && ex.tickets.find(t => t.number === T).messages.some(m => m.body === 'On it') && Array.isArray(ex.clients) && Array.isArray(ex.macros) && ex.queues.some(q => q.name === 'Billing') && Array.isArray(ex.articles) && ex.organization.slug === 'acme');
check('the export never holds password or session data', !/password|token|secret/i.test(r.body.json.replace(/"body": "[^"]*"/g, '')));
check('a part past the end is empty, not an error', JSON.parse((await A(olivia, 'export-data', { part: 5 })).body.json).tickets.length === 0);
r = await A(olivia, 'export-tickets-csv'); check('the ticket list downloads as a CSV', /^number,subject/.test(r.body.csv) && /Leak/.test(r.body.csv));
await A(olivia, 'macro-save', { name: '=HYPERLINK("x")', body: 'b' }); await A(olivia, 'create', { subject: '=SUM(1+1)', body: 'x', requesterEmail: 't@x.com' });
check('spreadsheet formulas in a CSV are defused', !/(^|,|\n)=SUM/.test((await A(olivia, 'export-tickets-csv')).body.csv));
check('exports are logged', (await A(olivia, 'audit-list', { filter: 'data-exported' })).body.entries.length >= 2);
// agent detail
await A(olivia, 'role-assign', { userId: bu, roleId: (await A(olivia, 'role-save', { name: 'Tier 2', permissions: ['reply', 'status'] })).body.id });
{ const d = (await A(olivia, 'agent-detail', { userId: bu })).body; const lt = (await A(olivia, 'team-list')).body.people.find(x => x.userId === bu);
  check('an agent\'s detail shows role, permissions, counts, tickets and recent activity', d.ok && d.person.email === 'bo@acme.test' && d.can.level === 'custom' && d.can.perms.join() === 'reply,status' && d.week.replies >= 1 && d.activity.some(a => a.number === T) && Array.isArray(d.tickets) && d.counts.open >= 0);
  check('the team list names the custom role and counts solved tickets', lt.customRole === 'Tier 2' && typeof lt.solved30 === 'number');
  check('an owner is described as having everything', (await A(olivia, 'agent-detail', { userId: ou })).body.can.level === 'everything');
  check('their recent changes come from the audit log on a plan that has it', Array.isArray((await A(olivia, 'agent-detail', { userId: ou })).body.changes) && (await A(olivia, 'agent-detail', { userId: ou })).body.changes.length > 0);
  check('only admins see agent detail, and not across workspaces', (await A(bo, 'agent-detail', { userId: ou })).status === 403 && (await A(olivia, 'agent-detail', { userId: otto.user.id })).status === 404); }
await pool.end(); done(); process.exit(0);
