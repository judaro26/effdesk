// scripts/test-email.js: EMAIL FOR TICKETS ON A REAL POSTGRES: settings, reply modes (private ticket address, own address, no-reply), sending limits, receiving customer email (new ticket, reply, reopen, follow-up), spam and loop protection, and the signed webhook.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets, inboundEmail } from '../src/handlers.js';
import { stripQuoted, isAutomated, verifySvix, ticketToken, handleInbound } from '../src/ticket-mail.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery', WH = 'whsec_' + crypto.randomBytes(24).toString('base64');
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_WEBHOOK_SECRET: WH, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('email'); await migrate(url);
const pool = makePool(url), outbox = []; let failSend = false;
const mailer = makeMailer({ transport: async m => { if (failSend) throw new Error('provider down'); outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { cookie, headers: new Headers({ cookie }), user: r.response.user }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const acme = await auth.api.createOrganization({ body: { name: 'Acme Rentals', slug: 'acme-rentals' }, headers: olivia.headers });
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
const call = async (who, body) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify(body) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const inbound = (over = {}) => handleInbound(pool, ENV, { from: 'tina@example.com', to: ['acme@in.effdesk.test'], messageId: '<' + crypto.randomBytes(6).toString('hex') + '@mail.example.com>', subject: 'Heater broken', text: 'It is cold.', headers: {}, ...over });
const ticket = async (n, org = acme.id) => (await withOrg(pool, org, async c => ({ t: (await c.query('select * from tickets where org_id = $1 and number = $2', [org, n])).rows[0], m: (await c.query('select kind, body, author_name, delivery from ticket_messages where org_id = $1 and ticket_id = (select id from tickets where org_id = $1 and number = $2) order by id', [org, n])).rows })));

// settings
let r = await call(olivia, { orgId: acme.id, action: 'mail-get' });
check('before setup there is no address, a suggestion from the organization\'s slug, and replies come back into the ticket', r.body.inbox === '' && r.body.suggestedInbox === 'acme-rentals' && r.body.replyMode === 'ticket' && r.body.domain === 'in.effdesk.test');
check('only an owner or admin may change the settings', (await call(ann, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'ticket' })).status === 403);
check('a reserved, too short or malformed address is refused', (await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'support', replyMode: 'ticket' })).status === 400 && (await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'ab', replyMode: 'ticket' })).status === 400 && (await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'Bad Name!', replyMode: 'ticket' })).status === 400);
check('"own address" needs a valid address that is not ours', (await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'custom', replyTo: 'nope' })).status === 400 && (await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'custom', replyTo: 'x@in.effdesk.test' })).status === 400);
r = await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'ticket', fromName: 'Acme Support', signature: 'Acme Rentals, 1 Main St' });
check('saving claims the address and returns it in full', r.status === 200 && r.body.address === 'acme@in.effdesk.test' && r.body.fromName === 'Acme Support');
check('another organization cannot take a claimed address', (await call(otto, { orgId: beta.id, action: 'mail-save', inbox: 'acme', replyMode: 'none' })).status === 409);

// receiving
r = await inbound({ from: 'Tina Tenant <tina@example.com>', headers: { from: 'Tina Tenant <tina@example.com>' } });
let tk = await ticket(1);
check('a customer\'s email to the address becomes ticket #1 on the email channel, with the sender\'s name and address', r.action === 'created' && tk.t.channel === 'email' && tk.t.requester_email === 'tina@example.com' && tk.t.requester_name === 'Tina Tenant' && tk.m[0].body === 'It is cold.');
check('mail to an address nobody has claimed is dropped, and so is mail from our own domain (loops)', (await inbound({ to: ['ghost@in.effdesk.test'] })).dropped === 'unknown-inbox' && (await inbound({ from: 'acme@in.effdesk.test' })).dropped === 'loop');
const first = '<same@mail.example.com>';
check('the same message delivered twice is stored once', (await inbound({ messageId: first })).ok && (await inbound({ messageId: first })).dropped === 'duplicate');
check('automatic mail is dropped (auto-replies, bulk, mailing lists, bounces, no-reply senders)', (await inbound({ headers: { 'auto-submitted': 'auto-replied' } })).dropped === 'automated' && (await inbound({ headers: { precedence: 'bulk' } })).dropped === 'automated' && (await inbound({ headers: { 'list-id': '<x.example.com>' } })).dropped === 'automated' && (await inbound({ from: 'mailer-daemon@example.com' })).dropped === 'automated' && !isAutomated({ 'auto-submitted': 'no' }, 'a@b.co'));
check('mail that fails DMARC is dropped as likely forged', (await inbound({ authentication: { dmarc: 'fail', spf: 'pass', dkim: 'pass' } })).dropped === 'auth-failed' && (await inbound({ authentication: { dmarc: 'pass' }, text: 'dmarc ok' })).ok);
check('quoted history is cut from replies, and an all-quoted message is kept whole', stripQuoted('Thanks!\n\nOn Mon, Nov 9, 2026 at 9:00 AM Acme <a@b.co> wrote:\n> hi') === 'Thanks!' && stripQuoted('Yes\n\n-----Original Message-----\nFrom: x') === 'Yes' && stripQuoted('Fine\n> quoted') === 'Fine' && stripQuoted('> only quoted') === '> only quoted');
r = await inbound({ subject: 'Photos', text: 'See attached', attachments: [{ filename: 'leak.jpg' }] });
check('attachments are not stored yet, and the message says so honestly', /1 attachment not stored: leak\.jpg/.test((await ticket(r.number)).m[0].body));

// sending
failSend = false; outbox.length = 0;
r = await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'We are sending someone today.' });
let mail = outbox[0];
check('an agent\'s public reply is emailed, and the response says "sent"', r.body.email === 'sent' && outbox.length === 1 && mail.to === 'tina@example.com' && mail.subject === '[#1] Heater broken');
check('from is the organization\'s name on its own address, with its signature below the text', mail.from === 'Acme Support <acme@in.effdesk.test>' && /\n-- \nAcme Rentals, 1 Main St/.test(mail.text) && /Acme Rentals, 1 Main St/.test(mail.html));
const tok = ticketToken(ENV, acme.id, 1);
check('in "ticket" mode Reply-To is a private address for this ticket', mail.replyTo === `acme+1.${tok}@in.effdesk.test` && mail.headers['Auto-Submitted'] === 'no' && /^<m\d+\.[0-9a-f]+@in\.effdesk\.test>$/.test(mail.headers['Message-ID']));
r = await inbound({ to: [mail.replyTo], text: 'Thanks, 3pm works.\n\nOn Mon, Ann wrote:\n> We are sending someone today.' });
tk = await ticket(1);
check('a customer\'s reply to that address lands in the same ticket, without the quoted text, and the ticket is open again', r.action === 'replied' && r.number === 1 && tk.m.at(-1).body === 'Thanks, 3pm works.' && tk.m.at(-1).kind === 'requester' && tk.t.status === 'open');
r = await inbound({ to: [`acme+1.000000000000@in.effdesk.test`], text: 'forged' });
check('a wrong private-address code does NOT reach the ticket: it becomes a new ticket instead', r.action === 'created' && r.number !== 1);
await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'Second answer.' });
const sentId = outbox.at(-1).headers['Message-ID'];
r = await inbound({ to: ['acme@in.effdesk.test'], headers: { 'in-reply-to': sentId }, text: 'Replying to your email normally' });
check('a reply sent to the plain address is matched by the Message-ID it answers, when it comes from the person who opened the ticket', r.action === 'replied' && r.number === 1);
r = await inbound({ from: 'stranger@example.com', to: ['acme@in.effdesk.test'], headers: { 'in-reply-to': sentId }, text: 'I am not the requester' });
check('but the same header from someone else starts a new ticket', r.action === 'created' && r.number !== 1);
await call(olivia, { orgId: acme.id, action: 'update', number: 1, patch: { status: 'solved' } });
r = await inbound({ to: [mail.replyTo], text: 'Still cold.' });
check('a reply to a solved ticket reopens it', r.reopened === true && (await ticket(1)).t.status === 'open');
await call(olivia, { orgId: acme.id, action: 'update', number: 1, patch: { status: 'closed' } });
r = await inbound({ to: [mail.replyTo], text: 'Cold again.' });
check('a reply to a closed ticket starts a follow-up ticket instead', r.action === 'followup' && (await ticket(r.number)).t.subject === 'Re: Heater broken' && (await ticket(1)).t.status === 'closed');
await call(olivia, { orgId: acme.id, action: 'update', number: 1, patch: { status: 'open' } });

// reply modes
await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'custom', replyTo: 'Help@AcmeRentals.com', fromName: '', signature: '' });
outbox.length = 0; await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'Custom reply address.' });
check('in "own address" mode Reply-To is the organization\'s own address, and the from name falls back to the organization name', outbox[0].replyTo === 'help@acmerentals.com' && outbox[0].from === 'Acme Rentals <acme@in.effdesk.test>');
await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'none' });
outbox.length = 0; await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'No reply please.' });
check('in "no-reply" mode the from is a no-reply address, there is no Reply-To, and the email says so', outbox[0].from === 'Acme Rentals <no-reply@in.effdesk.test>' && outbox[0].replyTo === undefined && /does not receive replies/.test(outbox[0].text) && (await inbound({ to: ['no-reply@in.effdesk.test'], text: 'hello?' })).dropped === 'unknown-inbox');
await call(olivia, { orgId: acme.id, action: 'mail-save', inbox: 'acme', replyMode: 'ticket' });
outbox.length = 0; await call(ann, { orgId: acme.id, action: 'note', number: 1, body: 'internal only' });
check('an internal note is never emailed', outbox.length === 0);

// failure and limits
failSend = true; r = await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'Provider is down.' }); failSend = false;
check('if the mail provider fails the reply is still saved and the response says "failed"', r.status === 200 && r.body.email === 'failed' && (await ticket(1)).m.at(-1).delivery === 'failed');
await withOrg(pool, acme.id, c => c.query(`insert into ticket_messages (org_id, ticket_id, kind, body, delivery) select $1, id, 'agent', 'bulk', 'sent' from tickets, generate_series(1, 50) where org_id = $1 and number = 1`, [acme.id]));
outbox.length = 0; r = await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'One more.' });
check('the free plan\'s daily limit stops further emails (the reply is saved, the response says "skipped")', r.body.email === 'skipped' && r.body.emailWhy === 'limit' && outbox.length === 0);
r = await call(otto, { orgId: beta.id, action: 'create', subject: 'S', body: 'b', requesterEmail: 'c@x.co' });
r = await call(otto, { orgId: beta.id, action: 'reply', number: 1, body: 'Hi' });
check('an organization with no address set up sends nothing', r.body.email === 'skipped' && r.body.emailWhy === 'no-inbox');
await pool.query('create role rls_tester'); await pool.query('grant select on mail_settings to rls_tester');
const asTenant = async orgId => { const c = await pool.connect(); try { await c.query('begin'); await c.query('set local role rls_tester'); await c.query("select set_config('app.org_id', $1, true)", [orgId]); const x = await c.query('select org_id from mail_settings'); await c.query('rollback'); return x.rows.map(y => y.org_id); } finally { c.release(); } };
check('settings are private to each organization (row level security, as an ordinary role like on Neon)', (await asTenant(beta.id)).length === 0 && (await asTenant(acme.id)).join() === acme.id);
await pool.query('revoke all on mail_settings from rls_tester'); await pool.query('drop role rls_tester');

// the webhook
const now = Date.now(), evBody = id => JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: id, from: 'web@example.com', to: ['acme@in.effdesk.test'], message_id: '<wh-' + id + '@m>', subject: 'Via webhook', attachments: [] } });
const svix = (body, id = 'msg_' + crypto.randomBytes(4).toString('hex'), ts = Math.floor(now / 1000), secret = WH) => ({ 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + crypto.createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64') });
const hookWith = (body, headers, fetchFn) => inboundEmail(new Request('http://x/api/webhooks/email', { method: 'POST', headers, body }), { pool, env: ENV, now, fetchFn }).then(async x => ({ status: x.status, body: await x.json() }));
const fakeFetch = (okRes = true) => async (u, o) => { fakeFetch.calls.push([u, o.headers.Authorization]); return okRes ? { ok: true, status: 200, json: async () => ({ from: 'Web Person <web@example.com>', to: ['acme@in.effdesk.test'], message_id: '<wh-1@m>', subject: 'Via webhook', text: 'Hello from the webhook', headers: { From: 'Web Person <web@example.com>' }, authentication: { dmarc: 'pass' }, attachments: [] }) } : { ok: false, status: 500, json: async () => ({}) }; }; fakeFetch.calls = [];
let b = evBody('em_1'), h = svix(b);
check('the signature check accepts a correct one and refuses a wrong key, an altered body and an old timestamp', verifySvix(b, new Headers(h), WH, now) && !verifySvix(b, new Headers(svix(b, undefined, undefined, 'whsec_' + Buffer.from('other-secret-other-secret').toString('base64'))), WH, now) && !verifySvix(b + ' ', new Headers(h), WH, now) && !verifySvix(b, new Headers(svix(b, undefined, Math.floor(now / 1000) - 3600)), WH, now) && !verifySvix(b, new Headers(), WH, now));
check('a bad signature is refused (401) and nothing is fetched or stored', (await hookWith(b, { ...h, 'svix-signature': 'v1,AAAA' }, fakeFetch())).status === 401 && fakeFetch.calls.length === 0);
r = await hookWith(b, h, fakeFetch());
check('a signed event fetches the full message with our key and creates the ticket', r.status === 200 && r.body.action === 'created' && fakeFetch.calls[0][0].endsWith('/emails/receiving/em_1') && fakeFetch.calls[0][1] === 'Bearer re_test' && !!(await ticket(r.body.number)).t && (await ticket(r.body.number)).m[0].body === 'Hello from the webhook' && (await ticket(r.body.number)).t.requester_name === 'Web Person');
r = await hookWith(b, h, fakeFetch());
check('the same event delivered again is acknowledged once and not repeated', r.status === 200 && r.body.duplicate === true && fakeFetch.calls.length === 1);
b = evBody('em_2'); h = svix(b); r = await hookWith(b, h, fakeFetch(false));
check('if the message cannot be fetched we answer 502 so Resend retries, and the event is not marked done', r.status === 502 && (await hookWith(b, h, fakeFetch())).status === 200);
b = JSON.stringify({ type: 'email.delivered', data: {} }); r = await hookWith(b, svix(b), fakeFetch());
check('other event types are acknowledged and ignored', r.status === 200 && r.body.ignored === true);
await pool.end(); done();
