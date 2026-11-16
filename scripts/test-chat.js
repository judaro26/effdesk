// scripts/test-chat.js: LIVE CHAT ON A REAL POSTGRES: a visitor starts a chat (a ticket), messages both ways, who may see what, the plan gate, and replies being emailed only when the chat window is closed.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets } from '../src/handlers.js';
import { chatApi, runChatLifecycle } from '../src/chat.js';
import { grantLicense } from '../src/license.js';
import { saveHelpImage } from '../src/help.js';
import { memoryStore } from '../src/storage.js';
import { listContacts } from '../src/contacts.js';
import { runJobs } from '../src/jobs.js';
import { deliverTicketEmailJob } from '../src/ticket-mail-jobs.js';
import { deliverAgentNoticeJob, deliverCsatSurveyJob } from '../src/notification-jobs.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('chat'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); return { cookie, user: r.response.user, headers: new Headers({ cookie }) }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });
const tk = async (who, action, orgId, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const flushEmailJobs = () => runJobs(pool, { 'ticket.email.deliver': (orgId, payload, job) => deliverTicketEmailJob(pool, mailer, null, ENV, orgId, payload, job), 'email.agent_notice': (orgId, payload, job) => deliverAgentNoticeJob(pool, mailer, orgId, payload, job), 'email.csat_survey': (orgId, payload, job) => deliverCsatSurveyJob(pool, mailer, ENV, orgId, payload, job) }, { batchSize: 50 });
const A = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); const body = await r.json(); await flushEmailJobs(); return { status: r.status, body }; };
const _unused = async n => (await A(olivia, 'get', { number: n })).body.messages;

await A(olivia, 'mail-save', { inbox: 'acme', replyMode: 'ticket', fromName: 'Acme' });

const C = async (method, path, body, ip = '1.1.1.1') => { const r = await chatApi(new Request('http://x' + path, { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: body ? JSON.stringify(body) : undefined }), { pool, mailer, env: ENV }); const result = { status: r.status, body: await r.json() }; await flushEmailJobs(); return result; };
check('chat is off until an admin turns it on', (await C('GET', '/api/chat/config?org=acme')).body.enabled === false && (await C('POST', '/api/chat/start?org=acme', { email: 'v@x.co', message: 'hi' })).status === 404);
const crossOriginConfig = await chatApi(new Request('http://x/api/chat/config?org=acme', { headers: { origin: 'null' } }), { pool, mailer, env: ENV });
check('public widget config allows cross-origin embeds, including opaque test origins', crossOriginConfig.status === 200 && crossOriginConfig.headers.get('access-control-allow-origin') === '*');
check('the free plan cannot configure chat', (await tk(otto, 'chat-get', beta.id)).status === 402);
check('only an admin can save the settings', (await A(ann, 'chat-save', { enabled: true })).status === 403);
let r = await A(olivia, 'chat-save', { enabled: true, title: 'Ask Acme', greeting: 'Hello!', color: '#aa0000' });
check('an admin turns chat on and the public config shows the look', r.status === 200 && (await C('GET', '/api/chat/config?org=acme')).body.title === 'Ask Acme' && (await C('GET', '/api/chat/config?org=acme')).body.color === '#aa0000');
check('a bad color falls back to the default', (await A(olivia, 'chat-save', { enabled: true, color: 'red; x' })).body.settings.color === '#1f73b7');
check('chat branding accepts a secure custom logo URL and returns it publicly', (await A(olivia, 'chat-save', { enabled: true, logoUrl: 'https://cdn.example.com/acme-logo.png' })).body.settings.logo_url === 'https://cdn.example.com/acme-logo.png' && (await C('GET', '/api/chat/config?org=acme')).body.logo === 'https://cdn.example.com/acme-logo.png');
check('chat branding rejects insecure or malformed logo URLs', (await A(olivia, 'chat-save', { enabled: true, logoUrl: 'http://example.com/logo.png' })).status === 400 && (await A(olivia, 'chat-save', { enabled: true, logoUrl: 'javascript:alert(1)' })).status === 400);
const logoStore = memoryStore();
const uploadedLogo = await saveHelpImage(pool, logoStore, acme.id, Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]));
const uploadedLogoSave = await A(olivia, 'chat-save', { enabled: true, logoAssetId: uploadedLogo.id });
const uploadedLogoConfig = await C('GET', '/api/chat/config?org=acme');
check('an organization can save a logo uploaded into its own help image storage', uploadedLogoSave.status === 200 && uploadedLogoSave.body.settings.logo_url === '/help/acme/img/' + uploadedLogo.id);
check('public chat config turns an uploaded logo path into an absolute same-origin image URL', uploadedLogoConfig.status === 200 && uploadedLogoConfig.body.logo === 'http://x/help/acme/img/' + uploadedLogo.id);
check('chat settings reject a logo asset that does not belong to the workspace', (await A(olivia, 'chat-save', { enabled: true, logoAssetId: crypto.randomUUID() })).status === 404);

await A(olivia, 'chat-save', { enabled: true, title: 'Ask Acme', greeting: 'Hello!', color: '#aa0000' });
check('the public widget shows message mode when no agent is enabled for chat', (await C('GET', '/api/chat/config?org=acme')).body.accepting === false);
check('a chat needs a valid email and a message', (await C('POST', '/api/chat/start?org=acme', { email: 'nope', message: 'hi' })).status === 400 && (await C('POST', '/api/chat/start?org=acme', { email: 'v@x.co', message: '' })).status === 400);
const veraVisitorId = crypto.randomBytes(32).toString('hex');
r = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'Do you ship to Canada?', visitorId: veraVisitorId, pageUrl:'https://customer.example/support?session=private#section' });
const n = r.body.number, tok = r.body.token;
const initialChannel = (await pool.query('select channel from tickets where number = $1', [n])).rows[0]?.channel;
check('starting a chat makes a ticket on the chat channel and gives the visitor a token', r.status === 200 && n && tok && initialChannel === 'chat');
const prov=(await pool.query('select ip_address,page_url,identity_type from ticket_provenance p join tickets t on t.id=p.ticket_id where t.org_id=$1 and t.number=$2',[acme.id,n])).rows[0];
check('chat provenance captures server IP and strips sensitive page query strings',prov&&prov.ip_address==='1.1.1.1'&&prov.page_url==='https://customer.example/support'&&prov.identity_type==='visitor');
const preAccessInbox = await A(olivia, 'list', { status: 'active', channel: 'chat', limit: 100 });
check('an admin must explicitly enable their own chat access too', preAccessInbox.status === 403);
check('a teammate without Live Chat access cannot use the paginated inbox', (await A(ann, 'chat-inbox', { limit: 10 })).status === 403);
check('agents without Live Chat access cannot read reply notifications', (await A(ann, 'chat-reply-alerts', { initialize: true })).status === 403);
check('a teammate cannot list live chats until an admin grants access', (await A(ann, 'list', { status: 'active', channel: 'chat', limit: 100 })).status === 403);
check('unauthorized agents do not see chat tickets in All Tickets', !(await A(ann, 'list', { status: 'active', limit: 100 })).body.tickets.some(t => t.number === n));
check('unauthorized agents cannot open a chat ticket directly', (await A(ann, 'get', { number: n })).status === 403);
check('unauthorized agents cannot reply to a chat ticket directly', (await A(ann, 'reply', { number: n, body: 'I should not be able to reply.' })).status === 403);
check('admins without explicit Live Chat access cannot reply to chat tickets', (await A(olivia, 'reply', { number: n, body: 'Access should be required.' })).status === 403);
check('a teammate cannot switch on live chat before access is granted', (await A(ann, 'chat-availability-set', { available: true })).status === 403);
check('only an admin can grant live chat access', (await A(ann, 'chat-access-set', { userId: ann.user.id, enabled: true })).status === 403);
check('an admin can grant access to a full agent', (await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: true })).body.access === true);
check('an enabled agent can choose to accept live chats', (await A(ann, 'chat-availability-set', { available: true })).body.available === true);
check('the public widget shows chat mode when an eligible agent has capacity', (await C('GET', '/api/chat/config?org=acme')).body.accepting === true);
check('an agent can switch off live chat availability', (await A(ann, 'chat-availability-set', { available: false })).body.available === false);
check('the public widget returns to message mode when all agents stop accepting chats', (await C('GET', '/api/chat/config?org=acme')).body.accepting === false);
check('an offline agent cannot claim a waiting chat', (await A(ann, 'chat-claim', { number: n })).status === 409);
check('an offline agent cannot reply to an unclaimed live chat', (await A(ann, 'reply', { number: n, body: 'I am offline.' })).status === 409);
check('an agent with access can see the live chat inbox', (await A(ann, 'list', { status: 'active', channel: 'chat', limit: 100 })).status === 200);
check('an admin can revoke live chat access', (await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: false })).body.access === false);
check('revoking access also forces the agent offline', (await A(ann, 'chat-availability-set', { available: true })).status === 403);
check('a revoked agent cannot list live chats', (await A(ann, 'list', { status: 'active', channel: 'chat', limit: 100 })).status === 403);
const annMember = (await A(olivia, 'team-list')).body.people.find(p => p.userId === ann.user.id).memberId;
await A(olivia, 'team-role', { memberId: annMember, role: 'light' });
check('a light agent cannot be granted live chat access', (await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: true })).status === 400);
check('changing an agent to light revokes chat availability', (await A(ann, 'chat-availability-set', { available: true })).status === 403);
await A(olivia, 'team-role', { memberId: annMember, role: 'member' });
await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: true });
await A(ann, 'chat-availability-set', { available: true });
await pool.query("update agent_status set chat_last_seen_at = now() - interval '10 minutes' where org_id = $1 and user_id = $2", [acme.id, ann.user.id]);
const recoveredClaim = await A(ann, 'chat-claim', { number: n });
check('a manual Accept click refreshes an expired heartbeat without toggling availability off and on', recoveredClaim.status === 200 && recoveredClaim.body.alreadyAssigned === false);
await A(ann, 'availability-set', { available: false });
await A(olivia, 'routing-save', { enabled: true, strategy: 'round_robin' });
await A(olivia, 'chat-access-set', { userId: olivia.user.id, enabled: true });
const converted=await A(olivia,'chat-convert-to-ticket',{number:n}), copied=await A(olivia,'get',{number:converted.body.number}), repeated=await A(olivia,'chat-convert-to-ticket',{number:n});
check('chat conversion creates a regular ticket with the complete transcript and original timestamps',converted.status===200&&copied.body.ticket.channel==='web'&&copied.body.ticket.source_chat_ticket_id&&copied.body.messages.some(m=>m.body==='Do you ship to Canada?'));
check('chat conversion is idempotent and never creates duplicate tickets',repeated.status===200&&repeated.body.alreadyConverted&&repeated.body.number===converted.body.number);

const secondChat = await C('POST', '/api/chat/start?org=acme', { name: 'Mina', email: 'mina@x.co', message: 'Can I get help?' });
const secondTicket = await A(olivia, 'get', { number: secondChat.body.number });
check('chat availability is independent of general ticket availability', secondChat.status === 200 && secondTicket.body.ticket.assignee_id === ann.user.id);
await A(ann, 'availability-set', { available: true });
await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: false });
const unassignedTicket = await A(olivia, 'get', { number: secondChat.body.number });
check('revoking an agent returns their open chat tickets to the unassigned queue', unassignedTicket.body.ticket.assignee_id === null);

// An agent can claim waiting chats, but the server enforces the simultaneous-chat cap.
await A(olivia, 'chat-availability-set', { available: true });
const capSave = await A(olivia, 'chat-save', { enabled: true, maxConcurrent: 1, autoResolveHours: 24, reuseDays: 7 });
check('admins can configure a per-agent simultaneous-chat limit', capSave.status === 200 && capSave.body.settings.max_concurrent === 1);
check('chat lifecycle defaults can be configured to 24-hour resolution and 7-day reuse', capSave.body.settings.auto_resolve_hours === 24 && capSave.body.settings.reuse_days === 7);
check('chat lifecycle settings reject out-of-range values', (await A(olivia, 'chat-save', { autoResolveHours: 721 })).status === 400 && (await A(olivia, 'chat-save', { reuseDays: 31 })).status === 400);
const disabledLifecycle = await A(olivia, 'chat-save', { enabled: true, maxConcurrent: 1, autoResolveHours: 0, reuseDays: 0 });
check('admins can disable auto-resolution and conversation reuse independently', disabledLifecycle.status === 200 && disabledLifecycle.body.settings.auto_resolve_hours === 0 && disabledLifecycle.body.settings.reuse_days === 0);
await A(olivia, 'chat-save', { enabled: true, maxConcurrent: 1, autoResolveHours: 24, reuseDays: 7 });
const firstClaim = await A(olivia, 'chat-claim', { number: secondChat.body.number });
check('an available agent can atomically claim an unassigned chat', firstClaim.status === 200 && firstClaim.body.alreadyAssigned === false);
const thirdChat = await C('POST', '/api/chat/start?org=acme', { name: 'Noah', email: 'noah@x.co', message: 'I need a hand.' }, '2.2.2.2');
const thirdTicket = await A(olivia, 'get', { number: thirdChat.body.number });
check('auto-routing leaves new chats waiting when the eligible agent is at capacity', thirdTicket.status === 200 && thirdTicket.body.ticket.assignee_id === null);
check('an agent cannot claim beyond their simultaneous-chat limit', (await A(olivia, 'chat-claim', { number: thirdChat.body.number })).status === 409);

// Two separate claim requests cannot race past the same agent capacity.
const fourthChat = await C('POST', '/api/chat/start?org=acme', { name: 'Kai', email: 'kai@x.co', message: 'Question one.' }, '3.3.3.3');
const fifthChat = await C('POST', '/api/chat/start?org=acme', { name: 'Maya', email: 'maya@x.co', message: 'Question two.' }, '4.4.4.4');
const raiseCap = await A(olivia, 'chat-save', { enabled: true, maxConcurrent: 2 });
const parallelClaims = await Promise.all([
  A(olivia, 'chat-claim', { number: fourthChat.body.number }),
  A(olivia, 'chat-claim', { number: fifthChat.body.number })
]);
check('concurrent claims cannot exceed the agent chat limit', raiseCap.status === 200 && parallelClaims.filter(x => x.status === 200).length === 1 && parallelClaims.filter(x => x.status === 409).length === 1);
check('a chat already claimed by its agent can be claimed idempotently', (await A(olivia, 'chat-claim', { number: secondChat.body.number })).status === 200);
await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: true });
await A(ann, 'chat-availability-set', { available: true });
check('a different eligible agent cannot claim a chat already accepted by someone else', (await A(ann, 'chat-claim', { number: secondChat.body.number })).status === 409);

// Competing agents racing for the same waiting ticket must produce exactly one winner.
await A(olivia, 'routing-save', { enabled: false, strategy: 'round_robin' });
await A(olivia, 'chat-save', { enabled: true, maxConcurrent: 3 });
const sixthChat = await C('POST', '/api/chat/start?org=acme', { name: 'Riley', email: 'riley@x.co', message: 'Can someone help?' }, '5.5.5.5');
const sameTicketRace = await Promise.all([
  A(olivia, 'chat-claim', { number: sixthChat.body.number }),
  A(ann, 'chat-claim', { number: sixthChat.body.number })
]);
check('two agents racing to claim one chat produce exactly one winner', sameTicketRace.filter(x => x.status === 200).length === 1 && sameTicketRace.filter(x => x.status === 409).length === 1);
await A(olivia, 'chat-save', { enabled: true, maxConcurrent: 5 });
check('an available agent can claim the original waiting chat before replying', (await A(olivia, 'chat-claim', { number: n })).status === 200);
const inbox = await A(olivia, 'list', { status: 'active', channel: 'chat', limit: 100 });
check('an authorized admin can list open live-chat tickets', inbox.status === 200 && inbox.body.tickets.some(t => t.number === n && t.channel === 'chat'));
const pageOne = await A(olivia, 'chat-inbox', { limit: 2, offset: 0, view: 'all' });
const pageTwo = await A(olivia, 'chat-inbox', { limit: 2, offset: 2, view: 'all' });
check('the Live Chat inbox returns a bounded page and full filtered totals', pageOne.status === 200 && pageOne.body.tickets.length === 2 && pageOne.body.page.limit === 2 && pageOne.body.page.hasMore && pageOne.body.counts.total >= 3);
check('Live Chat inbox pages do not repeat the same conversations', pageTwo.status === 200 && pageTwo.body.tickets.length === 2 && pageOne.body.tickets.every(a => pageTwo.body.tickets.every(b => a.number !== b.number)));
const cursorPageOne = await A(olivia, 'chat-inbox', { limit: 2, cursorMode: true, cursor: '', view: 'all' });
const cursorPageTwo = await A(olivia, 'chat-inbox', { limit: 2, cursorMode: true, cursor: cursorPageOne.body.page.nextCursor, view: 'all' });
check('Live Chat inbox keyset pagination returns a continuation cursor and stable non-overlapping pages', cursorPageOne.status === 200 && cursorPageOne.body.tickets.length === 2 && cursorPageOne.body.page.hasMore === true && !!cursorPageOne.body.page.nextCursor && cursorPageTwo.status === 200 && cursorPageTwo.body.tickets.length > 0 && cursorPageOne.body.tickets.every(a => cursorPageTwo.body.tickets.every(b => a.number !== b.number)));
const invalidInboxCursor = await A(olivia, 'chat-inbox', { limit: 2, cursorMode: true, cursor: 'invalid-cursor', view: 'all' });
check('Live Chat inbox rejects malformed cursors', invalidInboxCursor.status === 400 && /inbox cursor is invalid/i.test(invalidInboxCursor.body.error));
const waitingPage = await A(olivia, 'chat-inbox', { limit: 10, view: 'waiting' });
check('the waiting filter returns only unassigned chats with matching totals', waitingPage.status === 200 && waitingPage.body.tickets.every(t => !t.assignee_id) && waitingPage.body.counts.total === waitingPage.body.counts.waiting);
const minePage = await A(olivia, 'chat-inbox', { limit: 10, view: 'mine' });
check('the assigned-to-me filter is scoped to the signed-in agent', minePage.status === 200 && minePage.body.tickets.every(t => t.assignee_id === olivia.user.id));
const searchPage = await A(olivia, 'chat-inbox', { limit: 10, q: 'vera@x.co' });
check('the Live Chat inbox searches customer email server-side', searchPage.status === 200 && searchPage.body.tickets.some(t => t.requester_email === 'vera@x.co'));
const agentSearchPage = await A(olivia, 'chat-inbox', { limit: 10, q: 'olivia' });
check('the Live Chat inbox can find conversations by assigned agent name', agentSearchPage.status === 200 && agentSearchPage.body.tickets.some(t => t.assignee_id === olivia.user.id));
await pool.query("insert into contact_profiles (org_id,email,name,last_seen_at) select $1,'scale-'||g||'@example.test','Scale Contact '||g,now()-(g * interval '1 minute') from generate_series(1,6) g on conflict (org_id,email) do nothing", [acme.id]);
const contactsPageOne = await listContacts(pool, acme.id, 'scale-', 2, 0);
const contactsPageTwo = await listContacts(pool, acme.id, 'scale-', 2, 2);
check('the contact directory returns bounded pages with the full search result count', contactsPageOne.total === 6 && contactsPageOne.contacts.length === 2 && contactsPageOne.page.hasMore);
check('contact directory pagination returns subsequent contacts without duplicates', contactsPageTwo.contacts.length === 2 && contactsPageOne.contacts.every(a => contactsPageTwo.contacts.every(b => a.email !== b.email)));


check('the token is the only way in: wrong token, other number, other workspace', (await C('GET', `/api/chat/poll?org=acme&n=${n}&t=wrong&after=0`)).status === 403 && (await C('GET', `/api/chat/poll?org=acme&n=${n + 1}&t=${tok}&after=0`)).status === 403 && (await C('POST', '/api/chat/send?org=acme', { number: n, token: 'x', message: 'hi' })).status === 403);
let p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
check('polling returns the visitor\'s own message', p.status === 200 && p.body.messages.length === 1 && p.body.messages[0].from === 'you');
await pool.query("update tickets set chat_seen_at=now()-interval '20 seconds' where org_id=$1 and number=$2",[acme.id,n]);
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
const heartbeatRefreshed = (await pool.query('select chat_seen_at::text as seen from tickets where org_id=$1 and number=$2',[acme.id,n])).rows[0].seen;
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
const heartbeatUnchanged = (await pool.query('select chat_seen_at::text as seen from tickets where org_id=$1 and number=$2',[acme.id,n])).rows[0].seen;
check('visitor presence refreshes after the heartbeat interval', new Date(heartbeatRefreshed).getTime() > Date.now() - 5000);
check('repeated idle polls within 15 seconds do not rewrite visitor presence', heartbeatRefreshed === heartbeatUnchanged);
check('chat polling does not show an agent typing indicator when no agent is typing', p.body.agentTyping === false);
await pool.query("insert into ticket_presence (org_id,ticket_id,user_id,name,typing,seen_at) select $1,id,$3,'Ann',true,now() from tickets where org_id=$1 and number=$2 on conflict (ticket_id,user_id) do update set typing=true,seen_at=now()", [acme.id, n, ann.user.id]);
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
check('a different workspace agent cannot spoof the assigned agent typing indicator', p.status === 200 && p.body.agentTyping === false);
await pool.query("insert into ticket_presence (org_id,ticket_id,user_id,name,typing,seen_at) select $1,id,$3,'Olivia',true,now() from tickets where org_id=$1 and number=$2 on conflict (ticket_id,user_id) do update set typing=true,seen_at=now()", [acme.id, n, olivia.user.id]);
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
check('chat polling reports the assigned agent name and active typing without exposing presence details', p.status === 200 && p.body.agentTyping === true && p.body.assigned === true && p.body.agentName === 'Olivia' && !('typingUserId' in p.body));
await pool.query("update ticket_presence set typing=false,seen_at=now() where org_id=$1 and user_id=$2 and ticket_id=(select id from tickets where org_id=$1 and number=$3)", [acme.id, olivia.user.id, n]);
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
check('chat polling does not show an agent typing indicator when no agent is typing', p.body.agentTyping === false);
await pool.query("insert into ticket_presence (org_id,ticket_id,user_id,name,typing,seen_at) select $1,id,$3,'Olivia',true,now() from tickets where org_id=$1 and number=$2 on conflict (ticket_id,user_id) do update set typing=true,seen_at=now()", [acme.id, n, olivia.user.id]);
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
check('chat polling reports the assigned agent name and active typing without exposing presence details', p.status === 200 && p.body.agentTyping === true && p.body.assigned === true && p.body.agentName === 'Olivia' && !('typingUserId' in p.body));
await pool.query("update ticket_presence set typing=false,seen_at=now() where org_id=$1 and user_id=$2 and ticket_id=(select id from tickets where org_id=$1 and number=$3)", [acme.id, olivia.user.id, n]);
outbox.length = 0;
await A(olivia, 'mail-save', { inbox: 'acme', replyMode: 'ticket' });
await A(olivia, 'reply', { number: n, body: 'Yes, **we do**.' });
check('while the chat window is open the reply is not emailed as well', !outbox.some(m => [].concat(m.to).join().includes('vera@x.co')));
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=${p.body.messages[0].id}`);
check('the reply shows up in the chat, without internal notes', p.body.messages.length === 1 && p.body.messages[0].from === 'agent' && p.body.messages[0].name === 'Olivia' && /we do/.test(p.body.messages[0].body));
await A(olivia, 'note', { number: n, body: 'secret note' });
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
check('internal notes never reach the visitor', !p.body.messages.some(m => /secret/.test(m.body)) && p.body.messages.length === 2);
const replyCursor = await A(olivia, 'chat-reply-alerts', { initialize: true });
r = await C('POST', '/api/chat/send?org=acme', { number: n, token: tok, message: 'Great, thanks' });
const replyFeed = await A(olivia, 'chat-reply-alerts', { after: replyCursor.body.cursor });
check('agent reply notifications return only new customer chat messages after the cursor', replyCursor.status === 200 && replyFeed.status === 200 && replyFeed.body.replies.some(x => x.number === n && x.requester_email === 'vera@x.co'));
check('the visitor can reply', r.status === 200 && (await A(olivia, 'get', { number: n })).body.messages.some(m => m.kind === 'requester' && /thanks/.test(m.body)));
const replyInbox = await A(olivia, 'list', { status: 'active', channel: 'chat', limit: 100 });
check('the chat inbox flags a customer reply awaiting an agent response', replyInbox.status === 200 && replyInbox.body.tickets.some(t => t.number === n && t.chat_last_public_message_kind === 'requester'));
await A(olivia, 'reply', { number: n, body: 'You are welcome.' });
const answeredInbox = await A(olivia, 'list', { status: 'active', channel: 'chat', limit: 100 });
check('the customer reply indicator clears after an agent responds', answeredInbox.status === 200 && answeredInbox.body.tickets.some(t => t.number === n && t.chat_last_public_message_kind === 'agent'));
await pool.query("update tickets set chat_seen_at = now() - interval '5 minutes' where number = $1", [n]);
outbox.length = 0; await A(olivia, 'reply', { number: n, body: 'Anything else?' });
check('after the visitor left, the reply is emailed', outbox.some(m => [].concat(m.to).join().includes('vera@x.co')));
const closeUpdate = await A(olivia, 'update', { number: n, patch: { status: 'closed' } });
const historyPage = await A(olivia, 'chat-inbox', { limit: 10, offset: 0, view: 'history' });
const activeAfterClose = await A(olivia, 'chat-inbox', { limit: 100, offset: 0, view: 'all' });
const historySearch = await A(olivia, 'chat-inbox', { limit: 10, offset: 0, view: 'history', q: 'vera@x.co' });
check('Chat History includes closed conversations with their final status', historyPage.status === 200 && historyPage.body.tickets.some(t => t.number === n && t.status === 'closed'));
check('Chat History excludes active conversations and the active inbox excludes closed chats', historyPage.body.tickets.every(t => ['solved','closed'].includes(t.status)) && !activeAfterClose.body.tickets.some(t => t.number === n));
check('Chat History search and totals are scoped to archived conversations', historySearch.status === 200 && historySearch.body.tickets.some(t => t.number === n) && historySearch.body.counts.total === historySearch.body.tickets.length);
check('Chat History returns resolution timestamps for archived conversations', historyPage.body.tickets.some(t => t.number === n && (t.closed_at || t.solved_at || t.updated_at)));
p = await C('GET', `/api/chat/poll?org=acme&n=${n}&t=${tok}&after=0`);
const closedSend = await C('POST', '/api/chat/send?org=acme', { number: n, token: tok, message: 'hello?' });
check('a closed chat says it ended and cannot take messages', closeUpdate.status === 200 && p.body.ended === true && closedSend.status === 409);
const returned = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'I have another question.', visitorId: veraVisitorId }, '6.6.6.1');
const returnedTicket = await A(olivia, 'get', { number: returned.body.number });
check('the same browser returning within 7 days reuses and reopens its recent conversation', returned.status === 200 && returned.body.reused === true && returned.body.number === n && returnedTicket.body.ticket.status === 'open' && returnedTicket.body.messages.some(m => m.body === 'I have another question.'));
await pool.query("update tickets set updated_at=now()-interval '25 hours', chat_seen_at=now()-interval '2 minutes' where org_id=$1 and number=$2", [acme.id, n]);
const protectedChat = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'Keep this open while I am here.', visitorId: crypto.randomBytes(32).toString('hex') }, '6.6.6.2');
await pool.query("update tickets set updated_at=now()-interval '25 hours', chat_seen_at=now()-interval '15 seconds' where org_id=$1 and number=$2", [acme.id, protectedChat.body.number]);
const lifecycleRun = await runChatLifecycle(pool, Date.now());
const resolvedTicket = await A(olivia, 'get', { number: n });
const protectedTicket = await A(olivia, 'get', { number: protectedChat.body.number });
check('the hourly lifecycle job resolves chats idle for at least 24 hours', lifecycleRun.actions >= 1 && resolvedTicket.body.ticket.status === 'solved');
check('a visitor actively polling is protected from automatic resolution', protectedTicket.body.ticket.status === 'open');
const resumed = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'Thanks, I am back.', visitorId: veraVisitorId }, '6.6.6.3');
const resumedTicket = await A(olivia, 'get', { number: n });
check('a visitor returning within the reuse window reopens the same auto-resolved ticket', resumed.status === 200 && resumed.body.reused === true && resumed.body.number === n && resumedTicket.body.ticket.status === 'open');
await pool.query("update tickets set updated_at=now()-interval '8 days' where org_id=$1 and number=$2", [acme.id, n]);
const afterReuseWindow = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'The reuse window has passed.', visitorId: veraVisitorId }, '6.6.6.4');
check('a return after the 7-day reuse window starts a new conversation', afterReuseWindow.status === 200 && afterReuseWindow.body.number !== n && afterReuseWindow.body.reused === false);
const separateBrowser = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'Separate browser conversation.', visitorId: crypto.randomBytes(32).toString('hex') }, '6.6.6.5');
check('a different browser identifier creates a separate conversation even for the same email', separateBrowser.status === 200 && separateBrowser.body.number !== afterReuseWindow.body.number);
let last; for (let i = 0; i < 8; i++) last = await C('POST', '/api/chat/start?org=acme', { email: 'spam@x.co', message: 'spam ' + i }, '9.9.9.9');
check('starting chats too fast is slowed down', last.status === 429);
check('a page on another site cannot post (origin check)', (await chatApi(new Request('http://x/api/chat/start?org=acme', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' }), { pool, mailer, env: ENV })).status === 403);
const deniedPost = await chatApi(new Request('http://x/api/chat/start?org=acme', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' }), { pool, mailer, env: ENV });
check('cross-origin write endpoints do not receive permissive CORS headers', deniedPost.status === 403 && !deniedPost.headers.has('access-control-allow-origin'));
// Visitor-controlled end and transcript requests are token-authenticated and public-message-only.
const finalChat = await C('POST', '/api/chat/start?org=acme', { name: 'Vera', email: 'vera@x.co', message: 'Please send me a transcript.' }, '7.7.7.7');
await A(olivia, 'note', { number: finalChat.body.number, body: 'private transcript note' });
const transcriptMailStart = outbox.length;
const transcriptRequest = await C('POST', '/api/chat/transcript?org=acme', { number: finalChat.body.number, token: finalChat.body.token }, '7.7.7.7');
const transcriptMail = outbox.slice(transcriptMailStart).find(m => m.to === 'vera@x.co');
check('a visitor can request a transcript by proving possession of their chat token', transcriptRequest.status === 200 && transcriptRequest.body.sent === true && !!transcriptMail);
check('emailed chat transcripts include public messages but exclude internal notes', !!transcriptMail && transcriptMail.text.includes('Please send me a transcript.') && !transcriptMail.text.includes('private transcript note') && !transcriptMail.html.includes('private transcript note'));
check('a visitor cannot request another conversation transcript with an invalid token', (await C('POST', '/api/chat/transcript?org=acme', { number: finalChat.body.number, token: 'wrong' }, '7.7.7.8')).status === 403);
const contextUpdate = await C('POST', '/api/chat/context?org=acme', { number: finalChat.body.number, token: finalChat.body.token, pageUrl: 'https://shop.example/products/new?session=private#details', pageTitle: 'New product' }, '7.7.7.8');
const contextAfter = (await pool.query('select page_url,page_title from ticket_provenance p join tickets t on t.id=p.ticket_id where p.org_id=$1 and t.number=$2',[acme.id,finalChat.body.number])).rows[0];
check('the visitor can update the current page with their chat token and URL secrets are stripped', contextUpdate.status === 200 && contextAfter.page_url === 'https://shop.example/products/new' && contextAfter.page_title === 'New product');
check('visitor context updates reject an invalid URL scheme', (await C('POST', '/api/chat/context?org=acme', { number: finalChat.body.number, token: finalChat.body.token, pageUrl: 'javascript:alert(1)' }, '7.7.7.8')).status === 400);
check('visitor context updates reject an incorrect chat token', (await C('POST', '/api/chat/context?org=acme', { number: finalChat.body.number, token: 'wrong', pageUrl: 'https://shop.example/' }, '7.7.7.8')).status === 403);

const supervisorAccess = await A(olivia, 'chat-access-set', { userId: ann.user.id, enabled: true });
const managerMonitor = await A(olivia, 'chat-monitor', { number: finalChat.body.number });
check('workspace admins can monitor an active live chat without changing its assignment', supervisorAccess.status === 200 && managerMonitor.status === 200 && managerMonitor.body.readOnly === true && managerMonitor.body.ticket.number === finalChat.body.number);
check('monitoring returns the transcript and visitor page context but no write capability', managerMonitor.body.messages.some(m => m.body === 'Please send me a transcript.') && managerMonitor.body.provenance.page_url === 'https://shop.example/products/new' && managerMonitor.body.readOnly === true);
const supervisorInbox = await A(olivia, 'chat-supervision-inbox', {});
check('workspace admins can load a tenant-scoped active Live Chat supervision inbox', supervisorInbox.status === 200 && supervisorInbox.body.chats.some(t => t.number === finalChat.body.number) && supervisorInbox.body.counts.total >= 1);
check('ordinary agents cannot monitor another agent chat without the supervision permission', (await A(ann, 'chat-monitor', { number: finalChat.body.number })).status === 403);
const supervisorRole = await A(olivia, 'role-save', { name: 'Chat Supervisor', permissions: ['chat_supervise'] });
await A(olivia, 'role-assign', { userId: ann.user.id, roleId: supervisorRole.body.id });
const customSupervisorInbox = await A(ann, 'chat-supervision-inbox', {});
check('a custom role with chat_supervise can access the supervisor inbox', customSupervisorInbox.status === 200 && customSupervisorInbox.body.chats.some(t => t.number === finalChat.body.number));
const privateCoach = await A(ann, 'chat-copilot', { number: finalChat.body.number, body: 'Try confirming the visitor’s delivery postcode before proceeding.' });
const coachedMessages = (await A(olivia, 'get', { number: finalChat.body.number })).body.messages;
check('a custom role with Live Chat supervision can add private coaching notes', privateCoach.status === 200 && privateCoach.body.message.kind === 'note' && coachedMessages.some(m => m.kind === 'note' && m.body.includes('delivery postcode')));
check('supervisory coaching is stored as an internal note and never as a visitor-facing reply', privateCoach.body.message.kind === 'note' && !outbox.slice(transcriptMailStart).some(m => String(m.text || '').includes('delivery postcode')));
const takeover = await A(ann, 'chat-takeover', { number: finalChat.body.number });
const afterTakeover = await pool.query('select assignee_id from tickets where org_id=$1 and number=$2', [acme.id, finalChat.body.number]);
check('a permitted supervisor can take over an active chat while preserving its ticket and transcript', takeover.status === 200 && afterTakeover.rows[0].assignee_id === ann.user.id);
check('a takeover creates an assignment event and audit entry', (await pool.query("select 1 from ticket_events e join tickets t on t.id=e.ticket_id where e.org_id=$1 and t.number=$2 and e.detail='Supervisor took over the live conversation'", [acme.id, finalChat.body.number])).rowCount === 1 && (await A(olivia, 'audit-list', { filter: 'live-chat.taken-over' })).body.entries.some(e => e.target === String(finalChat.body.number)));
check('an unprivileged agent cannot take over a chat by calling the endpoint directly', (await A(olivia, 'role-assign', { userId: ann.user.id, roleId: null })).status === 200 && (await A(ann, 'chat-takeover', { number: finalChat.body.number })).status === 403);
const visitorEnd = await C('POST', '/api/chat/end?org=acme', { number: finalChat.body.number, token: finalChat.body.token }, '7.7.7.7');
await pool.query("update tickets set chat_seen_at=now()-interval '2 minutes' where org_id=$1 and number=$2",[acme.id,finalChat.body.number]);
const endedPollBefore = (await pool.query('select chat_seen_at::text as seen from tickets where org_id=$1 and number=$2',[acme.id,finalChat.body.number])).rows[0].seen;
const finalPoll = await C('GET', '/api/chat/poll?org=acme&n=' + finalChat.body.number + '&t=' + encodeURIComponent(finalChat.body.token) + '&after=0');
const endedPollAfter = (await pool.query('select chat_seen_at::text as seen from tickets where org_id=$1 and number=$2',[acme.id,finalChat.body.number])).rows[0].seen;
check('a visitor can end their own chat and polling reports it as ended', visitorEnd.status === 200 && finalPoll.status === 200 && finalPoll.body.ended === true);
check('polling an ended chat does not keep its visitor-presence heartbeat alive', endedPollBefore === endedPollAfter);
check('ending a chat is idempotent and the visitor cannot send another message afterward', (await C('POST', '/api/chat/end?org=acme', { number: finalChat.body.number, token: finalChat.body.token }, '7.7.7.7')).status === 200 && (await C('POST', '/api/chat/send?org=acme', { number: finalChat.body.number, token: finalChat.body.token, message: 'After ending' }, '7.7.7.7')).status === 409);

const cooldownVisitorId = crypto.randomBytes(32).toString('hex');
const cooldownChat = await C('POST', '/api/chat/start?org=acme', { name:'Cooldown Visitor', email:'cooldown@example.test', message:'One quick question', visitorId:cooldownVisitorId });
const cooldownEnd = await C('POST', '/api/chat/end?org=acme', { number:cooldownChat.body.number, token:cooldownChat.body.token });
const blockedRestart = await C('POST', '/api/chat/start?org=acme', { name:'Cooldown Visitor', email:'cooldown@example.test', message:'Another question', visitorId:cooldownVisitorId });
check('visitor-ended chats enforce the configured 15-second restart cooldown server-side', cooldownChat.status===200 && cooldownEnd.status===200 && blockedRestart.status===429 && blockedRestart.body.retryAfterSeconds>0 && blockedRestart.body.retryAfterSeconds<=15);
check('the cooldown error tells the visitor how long to wait', blockedRestart.body.error.includes('seconds before starting another chat'));
const cooldownOff = await A(olivia,'chat-save',{restartCooldownSeconds:0});
const allowedRestart = await C('POST','/api/chat/start?org=acme',{name:'Cooldown Visitor',email:'cooldown@example.test',message:'Restart after cooldown disabled',visitorId:cooldownVisitorId});
check('workspace admins can disable visitor restart cooldown without changing other chat settings',cooldownOff.status===200 && cooldownOff.body.settings.restart_cooldown_seconds===0 && allowedRestart.status===200);
check('visitor restart cooldown rejects values outside 0 to 3600 seconds',(await A(olivia,'chat-save',{restartCooldownSeconds:3601})).status===400);
await A(olivia,'chat-save',{restartCooldownSeconds:15});
// Exercise a burst of independent visitors and simultaneous visitor replies against the real chat API.
const concurrentVisitors = await Promise.all(Array.from({ length: 12 }, (_, i) => {
  const id = i + 1;
  return C('POST', '/api/chat/start?org=acme', {
    name: 'Load Visitor ' + id,
    email: 'load-visitor-' + id + '@example.test',
    message: 'Concurrent conversation ' + id,
    visitorId: crypto.randomBytes(32).toString('hex')
  }, '10.44.0.' + id);
}));
const concurrentNumbers = concurrentVisitors.map(x => x.body.number);
check('a burst of 12 independent visitors can start chats concurrently without collisions', concurrentVisitors.every(x => x.status === 200 && x.body.token) && new Set(concurrentNumbers).size === 12);
const concurrentReplies = await Promise.all(concurrentVisitors.map((x, i) => C('POST', '/api/chat/send?org=acme', {
  number: x.body.number,
  token: x.body.token,
  message: 'Follow-up from visitor ' + (i + 1)
}, '10.44.1.' + (i + 1))));
check('12 visitors can post follow-up messages concurrently with their own chat tokens', concurrentReplies.every(x => x.status === 200));
const concurrentInbox = await A(olivia, 'chat-inbox', { limit: 100, cursorMode: true, view: 'all' });
check('the agent inbox returns every conversation from the concurrent visitor burst', concurrentInbox.status === 200 && concurrentNumbers.every(number => concurrentInbox.body.tickets.some(t => t.number === number)));
await pool.end(); done();
