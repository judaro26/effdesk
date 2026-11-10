// scripts/test-desk-features.js: THE DESK FEATURES ON A REAL POSTGRES: type, queues, labels, CC, follow, merge, timeline, edited messages, clients with notes, linked problem/incident tickets, macros, saved views, side conversations (mail out, reply in), plan gating, and keeping organizations apart.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets } from '../src/handlers.js';
import { handleInbound } from '../src/ticket-mail.js';
import { grantLicense } from '../src/license.js';
import { sideToken } from '../src/desk.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('deskfeat'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { cookie, headers: new Headers({ cookie }), user: r.response.user }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });
const call = async (who, body) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify(body) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const A = (who, action, extra = {}) => call(who, { orgId: acme.id, action, ...extra });
await A(olivia, 'mail-save', { inbox: 'acme', replyMode: 'ticket' });
const mk = async (subject, email = 'tina@example.com', extra = {}) => (await A(olivia, 'create', { subject, body: 'hello ' + subject, requesterEmail: email, ...extra })).body.ticket;
const t1 = await mk('Heater broken'), t2 = await mk('Heater still broken'), t3 = await mk('Parking', 'sam@initech.com');

// type, queue, labels, CC
let r = await A(olivia, 'update', { number: 1, patch: { type: 'incident' } });
check('a ticket has a type, and an unknown type is refused', r.body.ticket.type === 'incident' && (await A(olivia, 'update', { number: 1, patch: { type: 'nope' } })).status === 400);
r = await A(olivia, 'queue-save', { name: 'Maintenance' }); const qid = r.body.id;
check('an admin makes a queue; a duplicate name is refused; a member cannot make one', r.status === 200 && (await A(olivia, 'queue-save', { name: 'Maintenance' })).status === 409 && (await A(ann, 'queue-save', { name: 'Billing' })).status === 403);
r = await A(ann, 'update', { number: 1, patch: { queueId: qid } });
check('any agent can put a ticket in a queue, and the list filters by queue and by none', r.body.ticket.queue_id === qid && (await A(ann, 'list', { queue: String(qid) })).body.tickets.length === 1 && (await A(ann, 'list', { queue: 'none' })).body.tickets.length === 2 && (await A(ann, 'update', { number: 1, patch: { queueId: 99999 } })).status === 400);
await A(olivia, 'update', { number: 1, patch: { tags: 'Heat, urgent' } }); await A(olivia, 'update', { number: 2, patch: { tags: 'heat' } });
r = await A(ann, 'labels');
check('labels in use come back with counts, most used first, for autocomplete', r.body.labels[0].name === 'heat' && r.body.labels[0].n === 2 && r.body.labels.some(l => l.name === 'urgent'));
r = await A(olivia, 'update', { number: 1, patch: { cc: 'Bob@Corp.com, tina@example.com, bob@corp.com' } });
check('CC keeps valid addresses once, lower-cased, and drops the requester\'s own', r.body.ticket.cc.join() === 'bob@corp.com' && (await A(olivia, 'update', { number: 1, patch: { cc: 'not-an-email' } })).status === 400 && (await A(olivia, 'update', { number: 1, patch: { cc: Array.from({ length: 11 }, (_, i) => `a${i}@x.co`).join(',') } })).status === 400);
outbox.length = 0; await A(ann, 'reply', { number: 1, body: 'On it.' });
check('a public reply is copied to the CC people', outbox.length === 1 && outbox[0].cc.join() === 'bob@corp.com' && outbox[0].to === 'tina@example.com');

// follow
r = await A(ann, 'follow', { number: 1, on: true }); let g = await A(ann, 'get', { number: 1 });
check('an agent can follow a ticket, sees that they do, and can list what they follow', r.body.following === true && g.body.extras.following === true && g.body.extras.followers[0].email === 'ann@acme.test' && (await A(ann, 'list', { following: 'me' })).body.tickets.length === 1 && (await A(olivia, 'list', { following: 'me' })).body.tickets.length === 0);
await A(ann, 'follow', { number: 1, on: false });
check('and stop following', (await A(ann, 'get', { number: 1 })).body.extras.following === false);

// timeline and edited messages
g = await A(olivia, 'get', { number: 1 });
check('the timeline records creation, the type, queue, tags, CC and the reply, newest first', g.body.extras.events.length >= 6 && g.body.extras.events.some(e => e.kind === 'created') && g.body.extras.events.some(e => e.detail === 'Queue: Maintenance') && g.body.extras.events.some(e => e.kind === 'cc') && g.body.extras.events[0].kind !== 'created');
const reply = g.body.messages.find(m => m.kind === 'agent');
r = await A(olivia, 'edit-message', { number: 1, messageId: reply.id, body: 'Edited' });
check('only the author can edit a reply (not even an admin), and the customer\'s messages cannot be edited', r.status === 403 && (await A(ann, 'edit-message', { number: 1, messageId: g.body.messages[0].id, body: 'x' })).status === 403);
r = await A(ann, 'edit-message', { number: 1, messageId: reply.id, body: 'Edited by Ann' }); g = await A(ann, 'get', { number: 1 });
check('the author edits it, and it is marked edited with a timeline line', r.status === 200 && g.body.messages.find(m => m.id === reply.id).body === 'Edited by Ann' && g.body.messages.find(m => m.id === reply.id).edited_at && g.body.extras.events.some(e => e.kind === 'edit') && (await A(ann, 'edit-message', { number: 1, messageId: reply.id, body: '  ' })).status === 400);

// merge
await A(olivia, 'follow', { number: 2, on: true });
r = await A(olivia, 'merge', { number: 2, into: 1 }); g = await A(olivia, 'get', { number: 1 }); const g2 = await A(olivia, 'get', { number: 2 });
check('merging moves messages, tags and followers into the target and closes the source with a pointer', r.status === 200 && g.body.messages.some(m => /hello Heater still broken/.test(m.body)) && g.body.messages.some(m => m.kind === 'system' && /#2/.test(m.body)) && g2.body.ticket.status === 'closed' && g2.body.ticket.merged_into === 1 && g2.body.messages.length === 1 && g2.body.messages[0].kind === 'system' && g.body.extras.merged[0].number === 2 && g.body.extras.followers.some(f => f.email === 'olivia@acme.test'));
check('a merged ticket cannot be merged again, nor into itself, nor into a missing ticket, nor into a merged one', (await A(olivia, 'merge', { number: 2, into: 3 })).status === 409 && (await A(olivia, 'merge', { number: 3, into: 3 })).status === 400 && (await A(olivia, 'merge', { number: 3, into: 99 })).status === 404 && (await A(olivia, 'merge', { number: 3, into: 2 })).status === 409);

// clients
r = await A(olivia, 'client-save', { name: 'Initech', domain: '@Initech.com' }); const kid = r.body.id;
check('an admin makes a client with a domain; a bad domain is refused; a member cannot', r.status === 200 && (await A(olivia, 'client-save', { name: 'X', domain: 'not a domain' })).status === 400 && (await A(ann, 'client-save', { name: 'Y' })).status === 403 && (await A(olivia, 'client-save', { name: 'Initech' })).status === 409);
const t4 = await mk('Invoice', 'bill@initech.com');
check('a new ticket from the client\'s domain joins the client by itself', t4.client_id === kid && t3.client_id === null);
await A(olivia, 'update', { number: 3, patch: { clientId: kid } });
r = await A(ann, 'client-notes', { id: kid, notes: 'Pays late. Call Bill.' }); g = await A(ann, 'get', { number: 4 });
check('any agent saves notes; the ticket shows the client with notes, counts and people', r.status === 200 && g.body.extras.client.notes === 'Pays late. Call Bill.' && g.body.extras.client.stats.total === 2 && g.body.extras.client.stats.open === 2 && g.body.extras.client.people.length === 2 && (await A(ann, 'list', { client: String(kid) })).body.tickets.length === 2);

// problem and incident
r = await A(olivia, 'link', { number: 4, problem: 3 }); g = await A(olivia, 'get', { number: 3 });
check('linking makes #4 an incident of #3 and #3 a problem; the problem lists its incidents', r.status === 200 && g.body.ticket.type === 'problem' && g.body.extras.incidents[0].number === 4 && (await A(olivia, 'get', { number: 4 })).body.extras.problem.number === 3 && (await A(olivia, 'link', { number: 4, problem: 4 })).status === 400 && (await A(olivia, 'link', { number: 3, problem: 4 })).status === 409);
r = await A(olivia, 'problem-resolve', { number: 3 });
check('solving the problem solves its incidents with a note', r.body.solved === 1 && (await A(olivia, 'get', { number: 4 })).body.ticket.status === 'solved' && (await A(olivia, 'get', { number: 4 })).body.messages.at(-1).kind === 'system' && (await A(olivia, 'get', { number: 3 })).body.ticket.status === 'solved');
await A(olivia, 'unlink', { number: 4 });
check('unlinking returns the ticket to a question', (await A(olivia, 'get', { number: 4 })).body.ticket.problem_number === null && (await A(olivia, 'unlink', { number: 4 })).status === 400);

// macros and views
r = await A(olivia, 'macro-save', { name: 'Thanks', body: 'Thanks for writing, {{name}}.', status: 'solved', priority: 'low', addTags: 'Thanks, done' });
const init = (await A(ann, 'init')).body;
check('macros are saved by admins and offered to everyone, with their status, priority and tags', r.status === 200 && (await A(ann, 'macro-save', { name: 'x', body: 'y' })).status === 403 && init.macros[0].name === 'Thanks' && init.macros[0].status === 'solved' && init.macros[0].add_tags.join() === 'thanks,done' && init.admin === false && init.plan === 'pro' && init.queues.length === 1 && init.clients.length === 1);
r = await A(ann, 'view-save', { name: 'My heat', filter: { status: 'open', tag: 'heat', junk: 'x' } }); const vid = r.body.id;
check('a private view keeps only known filters, is visible to its owner only, and needs at least one filter', r.status === 200 && (await A(ann, 'init')).body.views.length === 1 && (await A(olivia, 'init')).body.views.length === 0 && (await A(ann, 'view-save', { name: 'Empty', filter: {} })).status === 400);
check('a shared view needs an admin, and only its owner or an admin deletes it', (await A(ann, 'view-save', { name: 'Team', filter: { status: 'open' }, shared: true })).status === 403 && (await A(olivia, 'view-delete', { id: vid })).status === 403 && (await A(ann, 'view-delete', { id: vid })).status === 200);

// side conversations
outbox.length = 0;
r = await A(ann, 'side-send', { number: 1, to: 'plumber@pipes.co', subject: 'Heater visit', body: 'Can you go on Tuesday?' }); const sid = r.body.sideId, m = outbox[0];
const tok = sideToken(ENV, acme.id, sid);
check('a side conversation emails the outside person from our address, with a private reply address and without copying the customer', r.body.email === 'sent' && m.to === 'plumber@pipes.co' && m.replyTo === `acme+s${sid}.${tok}@in.effdesk.test` && m.subject === '[#1] Heater visit' && !m.cc && !outbox.some(x => x.to === 'tina@example.com'));
const inb = (over = {}) => handleInbound(pool, ENV, { from: 'plumber@pipes.co', to: [m.replyTo], messageId: '<' + crypto.randomBytes(6).toString('hex') + '@pipes.co>', subject: 'Re: Heater visit', text: 'Tuesday is fine.\n\nOn Mon Ann wrote:\n> Can you go on Tuesday?', headers: {}, ...over });
r = await inb(); g = await A(ann, 'get', { number: 1 });
check('their reply is added to the side conversation (not to the ticket\'s public thread) and the quote is cut', r.action === 'side-replied' && r.number === 1 && g.body.extras.sides[0].messages.at(-1).body === 'Tuesday is fine.' && g.body.extras.sides[0].messages.at(-1).direction === 'in' && !g.body.messages.some(x => /Tuesday is fine/.test(x.body)));
check('a reply from someone else, or with a wrong code, is dropped', (await inb({ from: 'stranger@x.co' })).dropped === 'wrong-sender' && (await inb({ to: [`acme+s${sid}.000000000000@in.effdesk.test`] })).dropped === 'bad-token');
r = await A(ann, 'side-send', { number: 1, sideId: sid, body: 'Great, thanks.' });
check('the agent can answer in the same conversation, threaded to the earlier mail', r.body.email === 'sent' && !!outbox.at(-1).headers['In-Reply-To']);
await A(ann, 'side-close', { number: 1, sideId: sid });
check('a closed conversation takes no more mail in or out', (await A(ann, 'side-send', { number: 1, sideId: sid, body: 'x' })).status === 409 && (await inb()).dropped === 'side-closed' && (await A(ann, 'side-send', { number: 1, to: 'bad', body: 'x' })).status === 400);

// plan gating and isolation
const B = (who, action, extra = {}) => call(who, { orgId: beta.id, action, ...extra });
r = await B(otto, 'queue-save', { name: 'Q' });
check('on the free plan queues, clients, linked tickets, views and side conversations ask for an upgrade (402) and name the plan', r.status === 402 && /Team plan/.test(r.body.error) && (await B(otto, 'client-save', { name: 'C' })).status === 402 && (await B(otto, 'link', { number: 1, problem: 2 })).status === 402 && (await B(otto, 'view-save', { name: 'V', filter: { status: 'open' } })).status === 402 && /Suite plan/.test((await B(otto, 'side-send', { number: 1, to: 'a@b.co', body: 'x' })).body.error));
await B(otto, 'create', { subject: 'B1', body: 'x', requesterEmail: 'b@x.co' });
check('the free plan keeps type, labels, CC, follow, merge, macros and the timeline', (await B(otto, 'update', { number: 1, patch: { type: 'task', cc: 'c@x.co' } })).status === 200 && (await B(otto, 'follow', { number: 1 })).status === 200 && (await B(otto, 'macro-save', { name: 'M', body: 'b' })).status === 200 && (await B(otto, 'update', { number: 1, patch: { queueId: qid } })).status === 402 && (await B(otto, 'init')).body.queues.length === 0);
check('another organization cannot touch our queue, client, macro or side conversation', (await B(otto, 'queue-delete', { id: qid })).status === 402 && (await A(olivia, 'init')).body.queues.length === 1 && (await call(otto, { orgId: acme.id, action: 'merge', number: 1, into: 2 })).status === 403);

// themes
check('everyone starts on the classic theme', (await A(ann, 'init')).body.theme === 'classic');
check('a paid plan can choose a premium theme, and it is remembered for that person only', (await A(ann, 'prefs-save', { theme: 'aurora' })).status === 200 && (await A(ann, 'init')).body.theme === 'aurora' && (await A(olivia, 'init')).body.theme === 'classic');
check('the free plan can choose the two free themes but a premium one asks for an upgrade, and an unknown theme is refused', (await B(otto, 'prefs-save', { theme: 'midnight' })).status === 200 && (await B(otto, 'init')).body.theme === 'midnight' && (await B(otto, 'prefs-save', { theme: 'sunset' })).status === 402 && (await B(otto, 'prefs-save', { theme: 'nope' })).status === 400);
await pool.query("insert into desk_prefs (user_id, theme) values ($1,'orchid') on conflict (user_id) do update set theme = 'orchid'", [otto.user.id]);
check('a premium theme saved before the plan ended falls back to classic on the free plan', (await B(otto, 'init')).body.theme === 'classic');
done();
