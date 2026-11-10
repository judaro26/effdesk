// scripts/test-import.js: MOVING mdv's SUPPORT DATA IN, on a real Postgres: tickets with messages, notes, statuses, assignees, numbers, articles with translations, a dry run, repeating an import, and who may import.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { importData, tickets } from '../src/handlers.js';
import { importMdv } from '../src/importer.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery', ENV = { BETTER_AUTH_SECRET: SECRET };
process.env.PLATFORM_ADMIN_EMAILS = 'owner@effdesk.test';
const { url } = await freshDb('import'); await migrate(url);
const pool = makePool(url), mailer = makeMailer({ transport: async () => {} });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { cookie, headers: new Headers({ cookie }), user: r.response.user }; };
const owner = await signUp('owner@effdesk.test', 'Owner'), ann = await signUp('ann@mdv.test', 'Ann'), rando = await signUp('rando@x.test', 'Rando');
await pool.query('update "user" set "emailVerified" = true where email = $1', ['owner@effdesk.test']);
const mdv = await auth.api.createOrganization({ body: { name: 'mdv', slug: 'mdv' }, headers: owner.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: mdv.id } });
const t0 = Date.parse('2026-03-01T10:00:00Z'), ts = n => ({ _seconds: Math.floor((t0 + n * 3600e3) / 1000), _nanoseconds: 0 });
const DATA = {
  tickets: [
    { id: 'tk_a1', number: 41, subject: 'Cannot log in', category: 'access', priority: 'high', status: 'solved', labels: ['VIP', 'login'], workspaceName: 'Acme Homes', requester: { email: 'Boss@Acme.com', name: 'Bea Boss' }, assignee: { email: 'ann@mdv.test' }, createdAt: ts(0), updatedAt: ts(5), solvedAt: ts(5),
      messages: [{ id: 'm1', by: 'client', name: 'Bea Boss', at: ts(0), body: 'I cannot log in.' }, { id: 'm2', by: 'agent', name: 'Ann', at: ts(2), body: 'Try resetting your password.' }, { id: 'm3', by: 'agent', name: 'Ann', at: ts(3), body: 'internal: account locked', internal: true }, { id: 'm4', by: 'client', name: 'Bea Boss', at: ts(4), body: 'Works now!', files: [{ id: 'f1', name: 'screenshot.png', size: 1000 }] }] },
    { id: 'tk_a2', number: 42, subject: 'Waiting on engineering', category: 'bug', priority: 'urgent', status: 'hold', labels: [], requester: { email: 'x@y.co' }, assignee: { email: 'gone@mdv.test' }, createdAt: ts(1), updatedAt: ts(2), messages: [{ id: 'n1', by: 'client', at: ts(1), body: 'Bug!' }] },
    { id: 'tk_a3', number: 43, subject: 'Cancelled one', status: 'cancelled', requester: { email: 'z@y.co' }, createdAt: ts(2), updatedAt: ts(3), messages: [{ id: 'k1', by: 'client', at: ts(2), body: 'never mind' }] },
    { id: 'tk_a4', number: 41, subject: 'Number clash', status: 'waiting', requester: { email: 'q@y.co' }, createdAt: ts(3), updatedAt: ts(3), messages: [{ id: 'c1', by: 'client', at: ts(3), body: 'clash' }] },
    { id: 'tk_bad', subject: '', requester: { email: 'nope' }, messages: [] },
  ],
  articles: [
    { id: 'ar_1', title: 'Reset your password', body: 'Use the **forgot** link.', lang: 'en', group: 'a_g1', published: true, votesYes: 4, votesNo: 1, createdAt: ts(0), updatedAt: ts(1) },
    { id: 'ar_2', title: 'Restablecer tu contraseña', body: 'Usa el enlace.', lang: 'es', group: 'a_g1', published: true, createdAt: ts(0), updatedAt: ts(1) },
    { id: 'ar_3', title: 'Draft idea', body: 'Later.', lang: 'en', published: false, createdAt: ts(0), updatedAt: ts(0) },
    { id: 'ar_4', title: 'Another English in group', body: 'dup lang', lang: 'en', group: 'a_g1', published: true },
  ],
};
const post = async (who, body) => { const r = await importData(new Request('http://x/api/import', { method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { cookie: who.cookie } : {}) }, body: JSON.stringify(body) }), { pool, auth }); return { status: r.status, body: await r.json() }; };

check('only the platform owner may import (sign-in, then owner)', (await post(null, { orgSlug: 'mdv', data: DATA })).status === 401 && (await post(rando, { orgSlug: 'mdv', data: DATA })).status === 403 && (await post(owner, { orgSlug: 'nobody', data: DATA })).status === 404);
let r = await post(owner, { orgSlug: 'mdv', dryRun: true, data: DATA });
check('a dry run counts what would happen and writes nothing', r.status === 200 && r.body.dryRun && r.body.tickets.added === 4 && r.body.tickets.skipped === 1 && r.body.articles.added === 3 && r.body.articles.skipped === 1 && (await pool.query('select count(*)::int n from tickets')).rows[0].n === 0);
r = await post(owner, { orgSlug: 'mdv', data: DATA });
check('the import adds 4 tickets (1 invalid skipped), 7 messages and 3 articles (1 refused: same language in a group), with warnings that explain', r.status === 200 && r.body.tickets.added === 4 && r.body.tickets.skipped === 1 && r.body.messages === 7 && r.body.articles.added === 3 && r.body.articles.skipped === 1 && r.body.warnings.length >= 3 && r.body.filesNotCopied === 1);
const T = n => withOrg(pool, mdv.id, async c => ({ t: (await c.query('select * from tickets where org_id = $1 and number = $2', [mdv.id, n])).rows[0], m: (await c.query('select kind, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = (select id from tickets where org_id = $1 and number = $2) order by created_at, id', [mdv.id, n])).rows }));
let a = await T(41);
check('a ticket keeps its number, subject, priority, requester (lower-cased), dates and solved time', a.t.subject === 'Cannot log in' && a.t.priority === 'high' && a.t.requester_email === 'boss@acme.com' && a.t.requester_name === 'Bea Boss' && a.t.status === 'solved' && a.t.created_at.toISOString() === '2026-03-01T10:00:00.000Z' && a.t.solved_at.toISOString() === '2026-03-01T15:00:00.000Z');
check('messages keep their order, authors and kinds: client → requester, agent → agent, internal → note', a.m.map(x => x.kind).join() === 'requester,agent,note,requester,system' || a.m.map(x => x.kind).join() === 'requester,agent,note,system,requester');
check('the first public agent reply is the first response time', a.t.first_response_at.toISOString() === '2026-03-01T12:00:00.000Z');
check('labels, the category and the workspace become tags', a.t.tags.join() === 'vip,login,cat-access,ws-acme-homes');
check('the assignee is matched by email to a member of the organization', a.t.assignee_id === ann.user.id && (await T(42)).t.assignee_id === null);
check('"files not copied" is noted on the ticket in plain words, never silently dropped', a.m.some(x => x.kind === 'system' && /screenshot\.png/.test(x.body)));
check('statuses map: waiting/hold → pending (hold also tagged), cancelled → closed', (await T(42)).t.status === 'pending' && (await T(42)).t.tags.includes('on-hold') && (await T(43)).t.status === 'closed');
const clash = (await withOrg(pool, mdv.id, c => c.query("select number from tickets where source_id = 'mdv:tk_a4'"))).rows[0];
check('a ticket whose number is already taken gets the next free one', clash.number === 44);
check('the ticket counter continues after the highest imported number, so new tickets do not clash', (await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: ann.cookie }, body: JSON.stringify({ orgId: mdv.id, action: 'create', subject: 'New', body: 'x', requesterEmail: 'n@x.co' }) }), { pool, auth }).then(x => x.json())).ticket.number === 45);
const arts = (await withOrg(pool, mdv.id, c => c.query('select lang, slug, status, helpful_yes, helpful_no, group_id from help_articles where org_id = $1 order by slug', [mdv.id]))).rows;
check('articles keep language, published state and votes, and translations in one group stay linked', arts.length === 3 && arts.find(x => x.slug === 'reset-your-password').helpful_yes === 4 && arts.find(x => x.slug === 'draft-idea').status === 'draft' && arts.find(x => x.slug === 'reset-your-password').group_id === arts.find(x => x.lang === 'es').group_id);
r = await post(owner, { orgSlug: 'mdv', data: DATA });
check('repeating the import changes nothing (everything already there is recognised)', r.body.tickets.added === 0 && r.body.tickets.existing === 4 && r.body.articles.added === 0 && r.body.articles.existing === 3 && (await pool.query('select count(*)::int n from tickets')).rows[0].n === 5);
check('too many items in one request are refused with the limit', (await post(owner, { orgSlug: 'mdv', data: { tickets: Array(201).fill({ id: 'x' }) } })).status === 413);
check('the import is recorded in the audit log', (await withOrg(pool, mdv.id, c => c.query("select 1 from audit_log where action = 'data-imported'"))).rowCount >= 1);
check('importing into one organization never touches another', (await pool.query('select count(*)::int n from tickets where org_id <> $1', [mdv.id])).rows[0].n === 0);
await pool.end(); done();
