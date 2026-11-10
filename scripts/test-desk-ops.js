// scripts/test-desk-ops.js: NOTIFICATIONS TO AGENTS, SLA TARGETS AND REPORTS ON A REAL POSTGRES: who is emailed when a customer replies or a ticket is assigned, the switch and the 10-minute limit, SLA states and filters, reports and their CSV, and the plan gates.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets, inboundEmail } from '../src/handlers.js';
import { grantLicense } from '../src/license.js';
import { ticketToken } from '../src/ticket-mail.js';
import { slaOf } from '../src/sla.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery', WH = 'whsec_' + crypto.randomBytes(24).toString('base64');
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_WEBHOOK_SECRET: WH, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('deskops'); await migrate(url);
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
const A = (who, action, extra = {}) => call(who, { orgId: acme.id, action, ...extra }), B = (who, action, extra = {}) => call(who, { orgId: beta.id, action, ...extra });
await A(olivia, 'mail-save', { inbox: 'acme', replyMode: 'ticket' });
const mk = async (subject, email = 'tina@example.com', extra = {}) => (await A(olivia, 'create', { subject, body: 'hello ' + subject, requesterEmail: email, ...extra })).body.ticket;
const notices = () => outbox.filter(m => /^(The customer replied|A ticket was assigned|New reply in a side)/.test(m.subject));

// notifications
const t1 = await mk('Heater broken');
await A(ann, 'follow', { number: 1, on: true });
outbox.length = 0; await A(ann, 'update', { number: 1, patch: { assigneeId: olivia.user.id } });
check('assigning a ticket to someone emails them (and only them)', notices().length === 1 && notices()[0].to === 'olivia@acme.test' && /^A ticket was assigned to you: #1 Heater broken/.test(notices()[0].subject) && /desk\.html\?org=.+&ticket=1/.test(notices()[0].text));
outbox.length = 0; await A(olivia, 'update', { number: 1, patch: { assigneeId: olivia.user.id } });
check('assigning a ticket to yourself, or again to the same person, sends nothing', notices().length === 0);
const now = Date.now(), evBody = id => JSON.stringify({ type: 'email.received', created_at: new Date().toISOString(), data: { email_id: id, from: 'tina@example.com', to: [`acme+1.${ticketToken(ENV, acme.id, 1)}@in.effdesk.test`], message_id: '<wh-' + id + '@m>', subject: 'Re: Heater broken', attachments: [] } });
const svix = (body, id = 'msg_' + crypto.randomBytes(4).toString('hex'), ts = Math.floor(now / 1000)) => ({ 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + crypto.createHmac('sha256', Buffer.from(WH.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64') });
const fetchOf = text => async () => ({ ok: true, status: 200, json: async () => ({ from: 'Tina <tina@example.com>', to: [`acme+1.${ticketToken(ENV, acme.id, 1)}@in.effdesk.test`], message_id: '<wh-' + text + '@m>', subject: 'Re: Heater broken', text, headers: { From: 'Tina <tina@example.com>' }, authentication: { dmarc: 'pass' }, attachments: [] }) });
const hook = async text => { const b = evBody(text); const r = await inboundEmail(new Request('http://x/api/webhooks/email', { method: 'POST', headers: svix(b), body: b }), { pool, mailer, env: ENV, now, fetchFn: fetchOf(text) }); return r.json(); };
outbox.length = 0; let r = await hook('It is still cold.');
check('a customer\'s reply emails the follower and the assignee, with the message in it', r.action === 'replied' && notices().length === 2 && notices().map(m => m.to).sort().join() === 'ann@acme.test,olivia@acme.test' && /The customer replied: #1/.test(notices()[0].subject) && /It is still cold\./.test(notices()[0].text));
outbox.length = 0; await hook('And now it is freezing.');
check('a second reply within ten minutes sends nobody another email', notices().length === 0);
await pool.query('delete from desk_notify_log');
await A(ann, 'prefs-save', { notify: false });
check('the switch is remembered, and the theme stays as it was', (await A(ann, 'init')).body.notify === false && (await A(ann, 'init')).body.theme === 'classic' && (await A(olivia, 'init')).body.notify === true);
outbox.length = 0; await hook('Anyone there?');
check('a person who switched notifications off is not emailed', notices().length === 1 && notices()[0].to === 'olivia@acme.test');
check('prefs-save with nothing to save is refused', (await A(ann, 'prefs-save', {})).status === 400);

// SLA
r = await A(ann, 'sla-save', { policies: { normal: { firstResponseMin: 60, resolveMin: 480 } } });
check('only an admin sets SLA targets', r.status === 403);
check('a target must be 1 minute to 1 year, and the first reply cannot be due after the solve', (await A(olivia, 'sla-save', { policies: { normal: { firstResponseMin: 0, resolveMin: 5 } } })).status === 400 && (await A(olivia, 'sla-save', { policies: { normal: { firstResponseMin: 600, resolveMin: 60 } } })).status === 400 && (await A(olivia, 'sla-save', { policies: { high: { firstResponseMin: 'abc' } } })).status === 400);
r = await A(olivia, 'sla-save', { policies: { normal: { firstResponseMin: 60, resolveMin: 480 }, high: { firstResponseMin: 15, resolveMin: null } } });
const got = (await A(ann, 'sla-get')).body.policies;
check('targets are saved per priority and read back (empty means none)', r.status === 200 && got.normal.firstResponseMin === 60 && got.normal.resolveMin === 480 && got.high.firstResponseMin === 15 && got.high.resolveMin === null && got.low.firstResponseMin === null && (await A(ann, 'init')).body.sla.normal.resolveMin === 480);
const ago = (n, min) => pool.query("update tickets set created_at = now() - ($2 * interval '1 minute'), first_response_at = null where org_id = $1 and number = $3", [acme.id, min, n]);
const t2 = await mk('Fresh', 'a@x.co'), t3 = await mk('Almost late', 'b@x.co'), t4 = await mk('Late', 'c@x.co'), t5 = await mk('Urgent late', 'd@x.co', { priority: 'high' }), t6 = await mk('No targets', 'e@x.co', { priority: 'low' });
await ago(t3.number, 50); await ago(t4.number, 130); await ago(t5.number, 20);
await pool.query("update tickets set status = 'solved', solved_at = now() where org_id = $1 and number = 1", [acme.id]);
const byNum = async q => (await A(ann, 'list', q)).body.tickets;
let all = await byNum({ status: '' }); const st = n => all.find(t => t.number === n).sla;
check('each ticket shows where its targets stand: ok, at risk (80% used), breached, and none for a priority without targets', st(t2.number).worst === 'ok' && st(t3.number).worst === 'risk' && st(t4.number).worst === 'breached' && st(t5.number).worst === 'breached' && st(t6.number) === null && st(t4.number).first.state === 'breached');
check('the list filters by breached and at risk (active tickets only)', (await byNum({ sla: 'breached' })).map(t => t.number).sort().join() === [t4.number, t5.number].sort().join() && (await byNum({ sla: 'risk' })).map(t => t.number).join() === String(t3.number));
await A(ann, 'reply', { number: t4.number, body: 'Sorry for the wait.' });
const g4 = (await A(ann, 'get', { number: t4.number })).body.ticket.sla;
check('a late first reply is recorded as missed, and the ticket no longer counts as a breach to answer', g4.first.state === 'missed' && g4.resolve.state === 'ok');
const pol = { normal: { firstResponseMin: 60, resolveMin: 480 } }, base = { priority: 'normal', created_at: new Date(now - 30 * 60000), first_response_at: new Date(now - 10 * 60000), solved_at: null, status: 'open' };
check('a reply inside the target is "met", and a solved ticket stops its solve clock', slaOf(base, pol, now).first.state === 'met' && slaOf({ ...base, status: 'solved', solved_at: new Date(now - 5 * 60000) }, pol, now).resolve.state === 'met' && slaOf({ ...base, status: 'solved', solved_at: new Date(now + 600 * 60000) }, pol, now).resolve.state === 'missed');
r = await B(otto, 'sla-save', { policies: { normal: { firstResponseMin: 5 } } });
check('the free plan cannot use SLA or reports (402) and its list has no SLA data or filter', r.status === 402 && (await B(otto, 'sla-get')).status === 402 && (await B(otto, 'report')).status === 402 && (await B(otto, 'report-csv')).status === 402 && (await B(otto, 'create', { subject: 'x', body: 'y', requesterEmail: 'z@x.co' })).status === 200 && (await B(otto, 'list', { sla: 'breached' })).body.tickets.length === 1 && (await B(otto, 'list', {})).body.tickets[0].sla === undefined);

// reports
await mk('=HYPERLINK("http://evil")', 'f@x.co'); await mk('Comma, "quoted"', 'g@x.co');
await pool.query("update tickets set created_at = now() - interval '200 days' where org_id = $1 and number = $2", [acme.id, t6.number]);
const rep = (await A(olivia, 'report', { days: 30 })).body;
const sum = a => a.reduce((s, x) => s + x.n, 0);
check('the report counts the tickets of the window only (one ticket is 200 days old and left out), per day, status, priority and channel', rep.days === 30 && rep.total === 7 && rep.perDay.length === 30 && rep.perDay.reduce((s, d) => s + d.created, 0) === 7 && sum(rep.byStatus) === 7 && sum(rep.byPriority) === 7 && rep.byChannel[0].name === 'web' && (await A(olivia, 'report', { days: 7 })).body.total === 7 && (await A(olivia, 'report', { days: 5 })).body.days === 30);
check('it shows how fast the team answers and solves, who solved, and the SLA rate', rep.firstReply.answered === 1 && rep.firstReply.avgMin >= 130 && rep.resolution.solved === 1 && rep.solvedBy[0].name === 'Olivia' && rep.sla.judged >= 2 && rep.sla.breached >= 2 && rep.sla.rate >= 0 && rep.labels.length === 0);
const csv = (await A(olivia, 'report-csv', { days: 30 })).body;
const lines = csv.csv.trim().split('\r\n');
check('the CSV has a header and one line per ticket, is named for the range, and holds no formulas or broken quoting', csv.count === 7 && lines.length === 8 && lines[0].startsWith('number,subject,status') && csv.filename === 'effdesk-tickets-30d.csv' && csv.csv.includes(`"'=HYPERLINK(""http://evil"")"`) && csv.csv.includes('"Comma, ""quoted"""') && !/^=/m.test(csv.csv));
check('a member can read reports', (await A(ann, 'report')).status === 200 && (await A(ann, 'report')).body.total === 7);
done();
