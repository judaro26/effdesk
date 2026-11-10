// scripts/test-requests.js: AI ASSIST ON A REAL POSTGRES with a fake OpenAI: what is sent (a reply never sees internal notes), the plan gate, the monthly cap, failures, and that nothing is sent to anyone.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets, helpCenter } from '../src/handlers.js';
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
const H = async (slug, path, { method = 'GET', form, now = Date.now() } = {}) => { const r = await helpCenter(new Request('https://app.effdesk.test/help/' + slug + path, { method, headers: form ? { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://app.effdesk.test' } : {}, body: form ? new URLSearchParams(form).toString() : undefined }), { pool, mailer, env: ENV, now }); return { status: r.status, text: await r.text(), headers: r.headers }; };
const tokenOf = t => /name="ts" value="([^"]+)"/.exec(t)[1];
const count = async () => (await pool.query("select count(*)::int n from tickets where via_portal")).rows[0].n;
let page = await H('acme', '/requests/new');
check('the request page shows the form, a hidden trap field and a signed time token', page.status === 200 && /name="subject"/.test(page.text) && /name="website"/.test(page.text) && /name="ts"/.test(page.text));
check('the help center home links to it', /requests\/new/.test((await H('acme', '')).text));
const t0 = Date.now(), good = tok => ({ ts: tok, email: 'Rita@Example.com', name: 'Rita', subject: 'Heater broken', description: 'It is cold.', website: '' });
let r = await H('acme', '/requests/new', { method: 'POST', form: good(tokenOf(page.text)), now: t0 });
check('a form sent instantly is refused (bots) and creates nothing', r.status === 429 && /wait a moment/i.test(r.text) && (await count()) === 0);
r = await H('acme', '/requests/new', { method: 'POST', form: good('garbage'), now: t0 + 10000 }); check('a forged token is refused', r.status === 400 && (await count()) === 0);
const tok1 = tokenOf((await H('acme', '/requests/new', { now: t0 })).text);
r = await H('acme', '/requests/new', { method: 'POST', form: { ...good(tok1), website: 'http://spam' }, now: t0 + 10000 });
check('a filled trap field looks like success but creates nothing', r.status === 200 && (await count()) === 0);
r = await H('acme', '/requests/new', { method: 'POST', form: good(tok1), now: t0 + 10000 });
const tk1 = (await pool.query("select * from tickets where via_portal order by id desc limit 1")).rows[0];
check('a real request creates a web ticket from the customer, in lowercase', r.status === 200 && /Request received/.test(r.text) && tk1.channel === 'web' && tk1.requester_email === 'rita@example.com' && tk1.subject === 'Heater broken' && tk1.requester_name === 'Rita');
check('the confirmation names the ticket number', r.text.includes('#' + tk1.number));
check('the agents can see it', (await A(olivia, 'list')).body.tickets.some(t => t.number === tk1.number));
r = await H('acme', '/requests/new', { method: 'POST', form: { ...good(tok1), email: 'not-an-email' }, now: t0 + 10000 }); check('a bad email is refused with a message and keeps what was typed', r.status === 400 && /valid email/.test(r.text) && /Heater broken/.test(r.text));
r = await H('acme', '/requests/new', { method: 'POST', form: { ...good(tok1), subject: '' }, now: t0 + 10000 }); check('an empty subject is refused', r.status === 400 && /subject/i.test(r.text));
r = await H('acme', '/requests/new', { method: 'POST', form: good(tok1), now: t0 + 3 * 3600 * 1000 }); check('a form left open for hours is refused', r.status === 400 && /too long/.test(r.text));
for (let i = 0; i < 4; i++) await H('acme', '/requests/new', { method: 'POST', form: good(tok1), now: t0 + 10000 });
r = await H('acme', '/requests/new', { method: 'POST', form: good(tok1), now: t0 + 10000 });
check('one address may send 5 requests an hour, then it is asked to wait', r.status === 429 && /wait a while/.test(r.text) && (await pool.query("select count(*)::int n from tickets where via_portal and requester_email = 'rita@example.com'")).rows[0].n === 5);
// the admins' forms
check('only admins manage forms; the free plan cannot', (await A(ann, 'forms-list')).status === 403 && (await tk(otto, 'forms-list', beta.id)).status === 402);
const q = (await A(olivia, 'queue-save', { name: 'Billing' })).body, qs = (await A(olivia, 'init')).body.queues, qid = (qs.find(x => x.name === 'Billing') || {}).id;
await A(olivia, 'field-save', { key: 'order_number', label: 'Order number', type: 'text' });
r = await A(olivia, 'form-save', { name: 'Billing question', description: 'Charges and invoices', subjectHint: 'What is the charge for?', queueId: qid, type: 'task', priority: 'high', tags: 'Money, Invoice', fieldKeys: ['order_number', 'nope'] });
check('a form is saved with its queue, type, priority, labels and only real fields', r.status === 200 && (await A(olivia, 'forms-list')).body.forms[0].tags.join() === 'money,invoice' && (await A(olivia, 'forms-list')).body.forms[0].field_keys.join() === 'order_number');
check('a duplicate name is refused', (await A(olivia, 'form-save', { name: 'Billing question' })).status === 400);
const formId = (await A(olivia, 'forms-list')).body.forms[0].id;
page = await H('acme', '/requests/new?form=' + formId);
check('picking a form shows its description and extra fields', /Charges and invoices/.test(page.text) && /name="cf_order_number"/.test(page.text) && /Billing question/.test(page.text));
const tok2 = tokenOf(page.text);
r = await H('acme', '/requests/new', { method: 'POST', form: { ...good(tok2), email: 'sam@example.com', form: String(formId), cf_order_number: 'A-77' }, now: t0 + 10000 });
const tk2 = (await pool.query("select * from tickets where requester_email = 'sam@example.com'")).rows[0];
check('the ticket takes the form\'s queue, type, priority, labels and field values', r.status === 200 && tk2.queue_id === qid && tk2.type === 'task' && tk2.priority === 'high' && tk2.tags.join() === 'money,invoice' && tk2.custom.order_number === 'A-77' && String(tk2.form_id) === String(formId));
r = await H('acme', '/requests/new', { method: 'POST', form: { ...good(tok2), email: 'lee@example.com', form: '999999' }, now: t0 + 10000 }); check('an unknown form is refused', r.status === 404);
await A(olivia, 'form-save', { id: formId, name: 'Billing question', active: false });
check('a switched-off form is no longer offered or accepted', !/Billing question/.test((await H('acme', '/requests/new')).text) && (await H('acme', '/requests/new', { method: 'POST', form: { ...good(tok2), email: 'zed@example.com', form: String(formId) }, now: t0 + 10000 })).status === 404);
await A(olivia, 'form-delete', { id: formId }); check('a form can be deleted and the ticket stays', (await A(olivia, 'forms-list')).body.forms.length === 0 && !!(await pool.query("select 1 from tickets where requester_email = 'sam@example.com'")).rowCount);
// free plan: the plain form works, custom forms are ignored
await tk(otto, 'queue-save', beta.id, {}).catch(() => {});
page = await H('beta', '/requests/new'); r = await H('beta', '/requests/new', { method: 'POST', form: { ts: tokenOf(page.text), email: 'kim@example.com', subject: 'Hi', description: 'Hello', website: '' }, now: t0 + 10000 });
check('the free plan still has the plain request form', r.status === 200 && (await pool.query("select 1 from tickets where requester_email = 'kim@example.com' and org_id = $1", [beta.id])).rowCount === 1);
// the search widget
await A(olivia, 'article-save', { title: 'Heater repairs', body: 'Heaters are repaired within two days.', status: 'published' });
await A(olivia, 'article-save', { title: 'Heater secret draft', body: 'Not ready.', status: 'draft' });
r = await H('acme', '/api/search?q=heater'); const sj = JSON.parse(r.text);
check('the widget search answers in JSON that any website may read, published articles only', r.status === 200 && r.headers.get('access-control-allow-origin') === '*' && sj.results.length === 1 && sj.results[0].title === 'Heater repairs' && /\/help\/acme\/a\//.test(sj.results[0].url) && /requests\/new/.test(sj.request));
check('a one letter search returns nothing, and an unknown workspace is a 404', JSON.parse((await H('acme', '/api/search?q=h')).text).results.length === 0 && (await H('nosuch', '/api/search?q=heater')).status === 404);
await pool.end(); done(); process.exit(0);
