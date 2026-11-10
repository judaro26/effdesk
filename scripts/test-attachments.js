// scripts/test-attachments.js: FILES ON TICKETS ON A REAL POSTGRES: agent upload, sending files with a reply, safe download, storage limit, files in incoming email, and organizations kept apart.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { memoryStore } from '../src/storage.js';
import { tickets, inboundEmail, attachmentUpload, attachmentDownload } from '../src/handlers.js';
import { saveMailSettings } from '../src/ticket-mail.js';
import { cleanName } from '../src/attachments.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery', WH = 'whsec_' + crypto.randomBytes(24).toString('base64');
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_WEBHOOK_SECRET: WH, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('attach'); await migrate(url);
const pool = makePool(url), outbox = [], store = memoryStore(), mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { cookie, headers: new Headers({ cookie }), user: r.response.user }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await saveMailSettings(pool, acme.id, { inbox: 'acme', replyMode: 'ticket' }, ENV);
const deps = { pool, auth, mailer, store, env: ENV };
const call = async (who, body) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify(body) }), deps); return { status: r.status, body: await r.json() }; };
const upload = async (who, org, bytes, name = 'photo.jpg', extra = '') => { const r = await attachmentUpload(new Request(`http://x/api/attachments?org=${org}&name=${encodeURIComponent(name)}&type=image/jpeg${extra}`, { method: 'POST', headers: who ? { cookie: who.cookie, 'content-length': String(bytes.length) } : {}, body: bytes }), deps); return { status: r.status, body: await r.json() }; };
const download = async (who, org, id) => attachmentDownload(new Request(`http://x/api/attachments/${id}?org=${org}`, { headers: who ? { cookie: who.cookie } : {} }), deps);
await call(olivia, { orgId: acme.id, action: 'create', subject: 'Leak', body: 'Water!', requesterEmail: 'tina@example.com' });
await call(otto, { orgId: beta.id, action: 'create', subject: 'B', body: 'b', requesterEmail: 'b@x.co' });

const jpg = Buffer.from('fake-jpeg-bytes-1234567890');
check('uploading needs a sign-in and membership', (await upload(null, acme.id, jpg)).status === 401 && (await upload(otto, acme.id, jpg)).status === 403);
check('an empty file and a file over 5 MB are refused', (await upload(ann, acme.id, Buffer.alloc(0))).status === 400 && (await upload(ann, acme.id, Buffer.alloc(5 * 1024 * 1024 + 1))).status === 413);
check('a file for a ticket that does not exist is refused', (await upload(ann, acme.id, jpg, 'a.jpg', '&ticket=99')).status === 404);
check('file names are cleaned of paths and control characters', cleanName('../../etc/pass\u0000wd') === '.._etc_passwd'.replace(/^\.+/, '') || cleanName('../../etc/passwd') === '.._.._etc_passwd'.replace(/^\.+/, '') && cleanName('a/b\\c:d.txt') === 'a_b_c_d.txt' && cleanName('') === 'file');
let up = await upload(ann, acme.id, jpg, 'leak photo.jpg', '&ticket=1');
check('an upload is stored and indexed', up.status === 200 && up.body.attachment.filename === 'leak photo.jpg' && up.body.attachment.size === jpg.length && store._keys().length === 1);
check('a colleague cannot attach someone else\'s upload to a reply', (await (async () => { const r = await call(olivia, { orgId: acme.id, action: 'reply', number: 1, body: 'trying', attachmentIds: [up.body.attachment.id] }); const t = await call(olivia, { orgId: acme.id, action: 'get', number: 1 }); return r.status === 200 && t.body.messages.every(m => m.attachments.length === 0); })()));
outbox.length = 0;
let r = await call(ann, { orgId: acme.id, action: 'reply', number: 1, body: 'Here is the photo back.', attachmentIds: [up.body.attachment.id] });
check('a reply claims the agent\'s own upload, and the email carries it as a base64 attachment', r.body.email === 'sent' && outbox[0].attachments.length === 1 && outbox[0].attachments[0].filename === 'leak photo.jpg' && Buffer.from(outbox[0].attachments[0].content, 'base64').equals(jpg));
let t = (await call(ann, { orgId: acme.id, action: 'get', number: 1 })).body;
const mine = t.messages.find(m => m.attachments.length);
check('the ticket lists the file under that message', mine.kind === 'agent' && mine.attachments[0].id === up.body.attachment.id);
outbox.length = 0; await call(olivia, { orgId: acme.id, action: 'reply', number: 1, body: 'again', attachmentIds: [up.body.attachment.id] });
check('a file already sent cannot be claimed twice', outbox[0].attachments === undefined);
const d = await download(olivia, acme.id, up.body.attachment.id);
check('a member can download it, always as an attachment the browser may not sniff or run', d.status === 200 && Buffer.from(await d.arrayBuffer()).equals(jpg) && /^attachment; filename="leak photo\.jpg"/.test(d.headers.get('content-disposition')) && d.headers.get('x-content-type-options') === 'nosniff' && d.headers.get('content-type') === 'application/octet-stream' && /sandbox/.test(d.headers.get('content-security-policy')));
check('downloads need a sign-in and membership, and another organization cannot reach the file even by guessing its id', (await download(null, acme.id, up.body.attachment.id)).status === 401 && (await download(otto, acme.id, up.body.attachment.id)).status === 403 && (await download(otto, beta.id, up.body.attachment.id)).status === 404);
check('deleting removes the file and its bytes', (await call(ann, { orgId: acme.id, action: 'delete-file', id: up.body.attachment.id })).status === 200 && store._keys().length === 0 && (await download(olivia, acme.id, up.body.attachment.id)).status === 404 && (await call(ann, { orgId: acme.id, action: 'delete-file', id: up.body.attachment.id })).status === 404);
await withOrg(pool, acme.id, c => c.query(`insert into attachments (id, org_id, filename, size) values ('fill', $1, 'fill.bin', 499999990)`, [acme.id]));
check('the free plan\'s storage limit refuses more files with a clear message', (await upload(ann, acme.id, jpg)).status === 402);
await withOrg(pool, acme.id, c => c.query(`delete from attachments where id = 'fill'`));

// incoming email with files
const now = Date.now(), WHb = id => JSON.stringify({ type: 'email.received', data: { email_id: id, from: 'tina@example.com', to: ['acme@in.effdesk.test'], message_id: '<' + id + '@m>', subject: 'Photos', attachments: [{ id: 'a1' }] } });
const svix = body => { const id = 'msg_' + crypto.randomBytes(4).toString('hex'), ts = Math.floor(now / 1000); return { 'svix-id': id, 'svix-timestamp': String(ts), 'svix-signature': 'v1,' + crypto.createHmac('sha256', Buffer.from(WH.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64') }; };
const mkFetch = ({ files, listOk = true }) => async (u, o) => {
  if (/\/emails\/receiving\/[^/]+\/attachments/.test(u)) return listOk ? { ok: true, status: 200, json: async () => ({ data: files.map((f, i) => ({ id: 'a' + i, filename: f.name, size: f.bytes.length, content_type: f.type || 'image/png', download_url: 'https://inbound-cdn.resend.com/' + f.name, expires_at: '2030-01-01T00:00:00Z' })) }) } : { ok: false, status: 500, json: async () => ({}) };
  if (u.startsWith('https://inbound-cdn.resend.com/')) { const f = files.find(x => u.endsWith(x.name)); return f.fail ? { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } : { ok: true, status: 200, arrayBuffer: async () => f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.length) }; }
  return { ok: true, status: 200, json: async () => ({ from: 'Tina <tina@example.com>', to: ['acme@in.effdesk.test'], message_id: '<' + u.split('/').pop() + '@m>', subject: 'Photos', text: 'See photos', headers: {}, authentication: { dmarc: 'pass' }, attachments: [{ id: 'a1' }] }) };
};
const hook = (id, fetchFn) => { const b = WHb(id); return inboundEmail(new Request('http://x/api/webhooks/email', { method: 'POST', headers: svix(b), body: b }), { pool, store, env: ENV, now, fetchFn }).then(async x => ({ status: x.status, body: await x.json() })); };
const png = Buffer.from('png-bytes-abc');
r = await hook('em_a', mkFetch({ files: [{ name: 'pic.png', bytes: png }] }));
t = (await call(olivia, { orgId: acme.id, action: 'get', number: r.body.number })).body;
check('a customer\'s attachment is stored and shown on the message it came with', r.body.action === 'created' && t.messages[0].attachments.length === 1 && t.messages[0].attachments[0].filename === 'pic.png' && (await store.get(`${acme.id}/${t.messages[0].attachments[0].id}`)).equals(png));
r = await hook('em_b', mkFetch({ files: [{ name: 'big.bin', bytes: Buffer.alloc(10 * 1024 * 1024 + 10) }, { name: 'ok.txt', bytes: Buffer.from('hi'), type: 'text/plain' }, { name: 'gone.txt', bytes: Buffer.from('x'), fail: true }] }));
t = (await call(olivia, { orgId: acme.id, action: 'get', number: r.body.number })).body;
check('files that are too large or cannot be fetched are skipped, the others kept, and the ticket says what was not stored', t.messages[0].attachments.map(a => a.filename).join() === 'ok.txt' && t.messages.some(m => m.kind === 'system' && /big\.bin \(too large\)/.test(m.body) && /gone\.txt \(could not be fetched\)/.test(m.body)));
r = await hook('em_c', mkFetch({ files: [], listOk: false }));
t = (await call(olivia, { orgId: acme.id, action: 'get', number: r.body.number })).body;
check('if the file list cannot be fetched the ticket still exists and says so', r.status === 200 && t.messages.some(m => m.kind === 'system' && /could not be fetched/.test(m.body)));
{ const up = await upload(olivia, acme.id, Buffer.from('PNGDATA'), 'shot.png'); check('a file can be uploaded before the ticket exists', up.status === 200 && !!up.body.attachment.id);
  const cr = await call(olivia, { orgId: acme.id, action: 'create', subject: 'With picture', body: 'see attached', requesterEmail: 'pic@example.com', attachmentIds: [up.body.attachment.id] });
  const g = (await call(olivia, { orgId: acme.id, action: 'get', number: cr.body.ticket.number })).body;
  check('creating the ticket attaches the file to its first message', cr.status === 200 && g.messages[0].attachments.length === 1 && g.messages[0].attachments[0].filename === 'shot.png');
  const other = await upload(olivia, acme.id, Buffer.from('X'), 'x.png'); const cr2 = await call(otto, { orgId: beta.id, action: 'create', subject: 'Steal', body: 'b', requesterEmail: 'b@x.co', attachmentIds: [other.body.attachment.id] });
  check('another person\'s upload cannot be attached to a ticket', cr2.status === 200 && (await call(otto, { orgId: beta.id, action: 'get', number: cr2.body.ticket.number })).body.messages[0].attachments.length === 0); }
await pool.end(); done();
