// scripts/test-migration.js: MOVING FROM ZENDESK AND FRESHDESK ON A REAL POSTGRES with fake provider APIs: pages, messages, notes, statuses, numbers, articles, repeats, rate limits, bad credentials, and who may do it.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets } from '../src/handlers.js';
import { grantLicense } from '../src/license.js';

let FAKE = null; const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test' };
const ENV2 = { ...ENV, get __migrationFetch() { return FAKE; } };
const { url } = await freshDb('migration'); await migrate(url);
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


const J = (o, s = 200, h = {}) => ({ ok: s < 400, status: s, headers: { get: k => h[k.toLowerCase()] || null }, json: async () => o });
const calls = [];
FAKE = async (url, init) => {
  calls.push(url); const u = new URL(url), p = u.pathname;
  if (!/Basic /.test(init.headers.authorization)) return J({}, 401);
  if (u.host === 'bad.zendesk.com' || (u.host === 'acme.zendesk.com' && init.headers.authorization !== 'Basic ' + Buffer.from('boss@acme.test/token:good').toString('base64'))) return J({}, 401);
  if (u.host === 'slow.zendesk.com') return J({}, 429, { 'retry-after': '7' });
  if (p === '/api/v2/tickets/count.json') return J({ count: { value: 3 } });
  if (p === '/api/v2/incremental/tickets/cursor.json') {
    if (!u.searchParams.get('cursor')) return J({ tickets: [{ id: 41, subject: 'Printer jams', status: 'open', priority: 'high', requester_id: 1, assignee_id: 2, tags: ['printer', 'Hardware'], created_at: '2024-01-02T10:00:00Z', updated_at: '2024-01-03T10:00:00Z' }, { id: 42, subject: 'Refund', status: 'closed', priority: null, requester_id: 1, assignee_id: null, tags: [], created_at: '2024-02-01T10:00:00Z', updated_at: '2024-02-02T10:00:00Z' }, { id: 43, subject: 'gone', status: 'deleted', requester_id: 1 }], after_cursor: 'C1', end_of_stream: false });
    return J({ tickets: [{ id: 44, subject: '', status: 'hold', requester_id: 9, tags: [], created_at: '2024-03-01T10:00:00Z', updated_at: '2024-03-01T10:00:00Z' }], after_cursor: 'C2', end_of_stream: true });
  }
  if (p === '/api/v2/users/show_many.json') return J({ users: [{ id: 1, email: 'Tina@Example.com', name: 'Tina', role: 'end-user' }, { id: 2, email: 'olivia@acme.test', name: 'Olivia', role: 'agent' }] });
  if (/\/api\/v2\/tickets\/\d+\/comments\.json/.test(p)) return J({ users: [{ id: 1, email: 'tina@example.com', name: 'Tina', role: 'end-user' }, { id: 2, email: 'olivia@acme.test', name: 'Olivia', role: 'agent' }], comments: [{ id: 1000 + Number(p.split('/')[4]), author_id: 1, public: true, plain_body: 'It jams', created_at: '2024-01-02T10:00:00Z', attachments: [{ file_name: 'photo.png' }] }, { id: 2000 + Number(p.split('/')[4]), author_id: 2, public: false, plain_body: 'internal: check the roller', created_at: '2024-01-02T11:00:00Z' }, { id: 3000 + Number(p.split('/')[4]), author_id: 2, public: true, plain_body: 'Try this', created_at: '2024-01-02T12:00:00Z' }] });
  if (p === '/api/v2/help_center/articles.json') return J({ articles: [{ id: 7, title: 'Reset password', body: '<p>Click <b>Forgot</b> on <a href="https://x.test/login">the login page</a>.</p><ul><li>one</li></ul><script>x</script>', locale: 'en-us', draft: false }], next_page: null });
  // Freshdesk
  if (u.host === 'acme.freshdesk.com') {
    if (init.headers.authorization !== 'Basic ' + Buffer.from('fdkey:X').toString('base64')) return J({}, 401);
    if (p === '/api/v2/agents') return J([{ id: 5, contact: { email: 'olivia@acme.test', name: 'Olivia' } }]);
    if (p === '/api/v2/tickets') return J(u.searchParams.get('page') === '1' ? [{ id: 9, subject: 'Login', description_text: 'cannot log in', status: 4, priority: 3, requester: { email: 'sam@example.com', name: 'Sam' }, responder_id: 5, tags: ['login'], created_at: '2024-04-01T10:00:00Z', updated_at: '2024-04-02T10:00:00Z' }] : []);
    if (/\/conversations$/.test(p)) return J([{ id: 91, body_text: 'we are on it', incoming: false, private: false, user_id: 5, created_at: '2024-04-01T11:00:00Z' }, { id: 92, body_text: 'private thought', incoming: false, private: true, user_id: 5, created_at: '2024-04-01T11:30:00Z' }, { id: 93, body_text: 'thanks', incoming: true, private: false, user_id: 0, created_at: '2024-04-01T12:00:00Z' }]);
    if (p === '/api/v2/solutions/categories') return J([{ id: 1 }]);
    if (/categories\/1\/folders/.test(p)) return J([{ id: 11 }]);
    if (/folders\/11\/articles/.test(p)) return J([{ id: 77, title: 'Billing FAQ', description: '<h2>Billing</h2><p>Pay <em>monthly</em>.</p>', status: 2, thumbs_up: 4, thumbs_down: 1 }]);
  }
  return J({}, 404);
};
const Z = { provider: 'zendesk', creds: { subdomain: 'acme', email: 'boss@acme.test', token: 'good' } };
check('only an admin can migrate', (await A(ann, 'migrate-run', Z)).status === 403 && (await A(ann, 'migrate-check', Z)).status === 403);
check('an unknown provider is refused', (await A(olivia, 'migrate-run', { provider: 'nope' })).status === 400);
check('a bad address is refused before any request is made', (await A(olivia, 'migrate-check', { provider: 'zendesk', creds: { subdomain: 'evil.com/x', email: 'a@b.co', token: 't' } })).status === 400 && !calls.some(u => /evil/.test(u)));
check('wrong credentials say so', (await A(olivia, 'migrate-check', { ...Z, creds: { ...Z.creds, token: 'bad' } })).status === 400 && /refused/.test((await A(olivia, 'migrate-check', { ...Z, creds: { ...Z.creds, token: 'bad' } })).body.error));
check('a check reports the number of tickets', (await A(olivia, 'migrate-check', Z)).body.total === 3);
let r = await A(olivia, 'migrate-run', { ...Z, cursor: null });
check('the first Zendesk page adds tickets (deleted ones are skipped) with their messages', r.status === 200 && r.body.tickets.added === 2 && r.body.messages === 6 && r.body.next.after === 'C1');
const tix = (await pool.query("select number, subject, status, priority, requester_email, tags, assignee_id, source_id from tickets where org_id = $1 order by number", [acme.id])).rows;
check('numbers, subjects, statuses, priorities and labels carry over', tix.map(t => t.number).join() === '41,42' && tix[0].status === 'open' && tix[1].status === 'closed' && tix[0].priority === 'high' && tix[1].priority === 'normal' && tix[0].tags.includes('hardware') && tix[0].source_id === 'zendesk:41');
check('the requester email is lowercased and the assignee is matched to the agent with that email', tix[0].requester_email === 'tina@example.com' && tix[0].assignee_id === olivia.user.id && tix[1].assignee_id === null);
const mrows = (await pool.query("select kind, body from ticket_messages where org_id = $1 and ticket_id = (select id from tickets where org_id = $1 and number = 41) order by created_at, id", [acme.id])).rows;
check('customer messages, internal notes and agent replies keep their kind, and attachment names are noted', mrows.some(m => m.kind === 'requester' && m.body === 'It jams') && mrows.some(m => m.kind === 'note' && /roller/.test(m.body)) && mrows.some(m => m.kind === 'agent' && m.body === 'Try this') && mrows.some(m => m.kind === 'system' && /photo\.png/.test(m.body)));
r = await A(olivia, 'migrate-run', { ...Z, cursor: r.body.next });
check('the last page adds the odd ticket (no subject, unknown requester) and moves on to articles', r.body.tickets.added === 1 && r.body.next.phase === 'articles' && (await pool.query("select subject, requester_email, status from tickets where org_id = $1 and number = 44", [acme.id])).rows[0].subject === '(no subject)');
r = await A(olivia, 'migrate-run', { ...Z, cursor: r.body.next });
const art = (await pool.query("select title, body, status, lang from help_articles where org_id = $1", [acme.id])).rows[0];
check('articles come in as text with their formatting, scripts removed, and end the run', r.body.articles.added === 1 && r.body.next === null && art.status === 'published' && /\*\*Forgot\*\*/.test(art.body) && /\[the login page\]\(https:\/\/x\.test\/login\)/.test(art.body) && /- one/.test(art.body) && !/script|x<\//.test(art.body.replace('x.test','')));
r = await A(olivia, 'migrate-run', { ...Z, cursor: null });
check('running it again changes nothing', r.body.tickets.added === 0 && r.body.tickets.existing === 2 && (await pool.query('select count(*)::int n from tickets where org_id = $1', [acme.id])).rows[0].n === 3);
check('new tickets continue after the highest imported number', (await A(olivia, 'create', { subject: 'Next', body: 'x', requesterEmail: 'n@x.co' })).body.ticket.number === 45);
check('a rate limit asks the caller to wait and repeat', await (async () => { const x = await A(olivia, 'migrate-run', { ...Z, creds: { ...Z.creds, subdomain: 'slow' } }); return x.status === 429 && x.body.retryAfter === 7; })());
const F = { provider: 'freshdesk', creds: { domain: 'acme', token: 'fdkey' } };
r = await A(olivia, 'migrate-run', F);
const fd = (await pool.query("select status, priority, assignee_id from tickets where org_id = $1 and number = 9", [acme.id])).rows[0];
check('Freshdesk tickets come in with their conversation, private notes and numeric statuses', r.status === 200 && r.body.tickets.added === 1 && r.body.messages === 4 && fd.status === 'solved' && fd.priority === 'high' && fd.assignee_id === olivia.user.id && (await pool.query("select 1 from ticket_messages where org_id = $1 and kind = 'note' and body = 'private thought'", [acme.id])).rowCount === 1);
r = await A(olivia, 'migrate-run', { ...F, cursor: r.body.next });
check('Freshdesk articles come from its categories and folders', r.body.articles.added === 1 && r.body.next === null && /# Billing/.test((await pool.query("select body from help_articles where org_id = $1 and title = 'Billing FAQ'", [acme.id])).rows[0].body));
check('a dry run counts without writing', (await A(olivia, 'migrate-run', { ...Z, cursor: null, dryRun: true })).body.tickets.existing === 2);
check('no customer was emailed by the migration', !outbox.some(m => /example\.com|imported\.invalid/.test([].concat(m.to).join())));
await pool.end(); done(); process.exit(0);
