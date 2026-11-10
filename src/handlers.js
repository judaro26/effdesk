// src/handlers.js: THE API, as plain functions of (Request, deps) → Response, so the tests can call them without Netlify. The files in netlify/functions only wire these to addresses.
import { PRODUCT, platformAdmins } from './config.js';
import { getEntitlements, seatsUsed, checkoutConfig, verifySignature, applyPaddleEvent } from './billing.js';
import { grantLicense, revokeLicense } from './license.js';
import { withOrg } from './db.js';
import { getMailSettings, saveMailSettings, sendTicketReply, handleInbound, verifySvix, parseAddress } from './ticket-mail.js';
import { saveUpload, claimUploads, filesOfMessage, readFile, deleteFile, storeInbound, MAX_UPLOAD, cleanName } from './attachments.js';
import { createTicket, listTickets, getTicket, addMessage, updateTicket, listAgents } from './tickets.js';

const json = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(extra || {}) } });
const readJson = async (req, max = 10000) => { try { const t = await req.text(); if (t.length > max) return null; const v = JSON.parse(t || '{}'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const session = async (auth, req) => { try { return await auth.api.getSession({ headers: req.headers }); } catch { return null; } };
const roleIn = async (pool, userId, orgId) => (await pool.query('select role from member where "userId" = $1 and "organizationId" = $2', [userId, orgId])).rows[0]?.role || '';
const audit = (pool, orgId, actorId, action, target, meta) => withOrg(pool, orgId, c => c.query('insert into audit_log (org_id, actor_id, action, target, meta) values ($1,$2,$3,$4,$5)', [orgId, actorId, action, target || null, JSON.stringify(meta || {})]));

// who am I, which organizations am I in, and what each one may do
export async function me(req, { pool, auth }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const orgs = (await pool.query(`select o.id, o.name, o.slug, m.role from member m join "organization" o on o.id = m."organizationId" where m."userId" = $1 order by o.name`, [s.user.id])).rows;
  const out = [];
  for (const o of orgs) { const ent = await getEntitlements(pool, o.id), used = await seatsUsed(pool, o.id); out.push({ ...o, plan: ent.plan, license: ent.license, seats: ent.seats === Infinity ? null : ent.seats, seatsUsed: used, features: [...ent.features] }); }
  return json(200, { user: { id: s.user.id, email: s.user.email, name: s.user.name, twoFactor: !!s.user.twoFactorEnabled }, organizations: out });
}

// the plan an owner or admin picked → the details the Paddle checkout needs
export async function checkout(req, { pool, auth, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const b = await readJson(req); if (!b) return json(400, { error: 'That request could not be read.' });
  const orgId = String(b.orgId || ''), role = await roleIn(pool, s.user.id, orgId);
  if (role !== 'owner' && role !== 'admin') return json(403, { error: 'Only an owner or an admin can change the plan.' });
  const used = await seatsUsed(pool, orgId), c = checkoutConfig({ orgId, plan: b.plan, interval: b.interval, seats: b.seats }, env);
  if (c.error) return json(400, { error: c.error });
  if (c.quantity < used) return json(400, { error: `You already have ${used} agents or invitations. Choose at least ${used} seats, or remove people first.` });
  return json(200, { ...c, customerEmail: s.user.email, clientToken: env.PADDLE_CLIENT_TOKEN || '', sandbox: env.PADDLE_ENV !== 'production' });
}

// the platform owner grants or takes back a lifetime licence (for example for mdv)
export async function license(req, { pool, auth }) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified || !platformAdmins().includes(String(s.user.email).toLowerCase())) return json(403, { error: 'Only the platform owner can do that.' });
  const b = await readJson(req); if (!b) return json(400, { error: 'That request could not be read.' });
  let orgId = String(b.orgId || ''); if (!orgId && b.slug) orgId = (await pool.query('select id from "organization" where slug = $1', [String(b.slug)])).rows[0]?.id || '';
  if (!orgId) return json(404, { error: 'No such organization.' });
  const r = req.method === 'POST' ? await grantLicense(pool, { orgId, actorEmail: s.user.email, note: b.note }) : await revokeLicense(pool, { orgId });
  if (!r.ok) return json(404, { error: r.error || 'There was no licence to remove.' });
  await audit(pool, orgId, s.user.id, req.method === 'POST' ? 'license-granted' : 'license-revoked', orgId, { by: s.user.email });
  return json(200, { ok: true });
}

// Paddle's events. The body is read as text first (the signature covers the exact bytes), then checked, then applied.
export async function paddleWebhook(req, { pool, env = process.env, now = Date.now() }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text();
  if (raw.length > 200000) return json(413, { error: 'Too large.' });
  if (!verifySignature(raw, req.headers.get('paddle-signature'), env.PADDLE_WEBHOOK_SECRET, now)) return json(401, { error: 'Bad signature.' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: 'Not JSON.' }); }
  const r = await applyPaddleEvent(pool, ev, env);
  if (!r.ok) { console.warn('paddle event not applied:', r.why, ev && ev.event_id); return json(r.why === 'malformed' ? 400 : 200, { ok: false, why: r.why }); }          // an event we cannot use is acknowledged (200) so Paddle does not retry it forever
  if (r.orgId && r.why === 'applied') await audit(pool, r.orgId, null, 'plan-changed', r.orgId, { plan: r.plan, seats: r.seats, status: r.status });
  return json(200, { ok: true, why: r.why });
}

// the agent desk: ONE door, POST {orgId, action, ...}. Every member of the organization may work tickets; the organization is checked on every call.
export async function tickets(req, { pool, auth, mailer, store, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const b = await readJson(req, 60000); if (!b) return json(400, { error: 'That request could not be read.' });
  const orgId = String(b.orgId || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  const actor = { id: s.user.id, name: s.user.name, email: s.user.email };
  let r;
  switch (b.action) {
    case 'list': r = await listTickets(pool, orgId, actor, b); break;
    case 'get': r = await getTicket(pool, orgId, actor, b.number); break;
    case 'create': r = await createTicket(pool, orgId, actor, b); break;
    case 'reply': {
      r = await addMessage(pool, orgId, actor, b.number, { body: b.body, internal: false, status: b.status });
      if (r.ok && store && Array.isArray(b.attachmentIds) && b.attachmentIds.length) await claimUploads(pool, orgId, actor, b.number, r.message.id, b.attachmentIds);
      if (r.ok && mailer) {
        const rows = store ? await filesOfMessage(pool, orgId, r.message.id) : [], files = [];
        for (const f of rows) { const x = await readFile(pool, store, orgId, f.id); if (x) files.push(x); }
        const d = await sendTicketReply(pool, mailer, env, orgId, Number(b.number), r.message.id, files); r.email = d.delivery; r.emailWhy = d.why;
      }
      break;
    }
    case 'delete-file': if (!store || !(await deleteFile(pool, store, orgId, b.id))) return json(404, { error: 'No such file.' }); r = { ok: true }; break;
    case 'mail-get': r = await getMailSettings(pool, orgId, env); break;
    case 'mail-save': if (role !== 'owner' && role !== 'admin') return json(403, { error: 'Only an owner or an admin can change the email settings.' }); r = await saveMailSettings(pool, orgId, b, env); break;
    case 'note': r = await addMessage(pool, orgId, actor, b.number, { body: b.body, internal: true }); break;
    case 'update': r = await updateTicket(pool, orgId, actor, b.number, b.patch || {}); break;
    case 'agents': r = { ok: true, agents: await listAgents(pool, orgId) }; break;
    default: return json(400, { error: 'Unknown action.' });
  }
  return r.ok ? json(200, r) : json(r.status || 400, { error: r.error });
}

// customers' email, posted by Resend (event email.received). The signature is checked on the exact bytes, the full message is fetched with our key, and anything we cannot use is acknowledged so it is not retried forever.
export async function inboundEmail(req, { pool, store, env = process.env, fetchFn = fetch, now = Date.now() }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text(); if (raw.length > 100000) return json(413, { error: 'Too large.' });
  if (!verifySvix(raw, req.headers, env.RESEND_WEBHOOK_SECRET, now)) return json(401, { error: 'Bad signature.' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: 'Not JSON.' }); }
  if (!ev || ev.type !== 'email.received' || !ev.data || !ev.data.email_id) return json(200, { ok: true, ignored: true });
  const evId = req.headers.get('svix-id');
  if ((await pool.query("select 1 from webhook_events where id = $1 and provider = 'resend'", [evId])).rowCount) return json(200, { ok: true, duplicate: true });
  let full;
  try {
    const r = await fetchFn(`https://api.resend.com/emails/receiving/${encodeURIComponent(ev.data.email_id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!r.ok) throw new Error('status ' + r.status); full = await r.json();
  } catch (e) { console.warn('could not fetch the received email:', e.message); return json(502, { error: 'Could not fetch the message.' }); }
  const res = await handleInbound(pool, env, { from: full.from || ev.data.from, to: full.to || ev.data.to, receivedFor: full.received_for || ev.data.received_for, messageId: full.message_id || ev.data.message_id, subject: full.subject || ev.data.subject, text: full.text, html: full.html, headers: full.headers, authentication: full.authentication, attachments: full.attachments || ev.data.attachments });
  if (res.ok && store && (full.attachments || ev.data.attachments || []).length) await storeInbound(pool, store, fetchFn, env, res.orgId, res.number, res.messageRowId, ev.data.email_id);
  await pool.query("insert into webhook_events (id, provider, type) values ($1,'resend','email.received') on conflict do nothing", [evId]);
  if (res.dropped) console.log('inbound email dropped:', res.dropped);
  return json(200, { ok: true, ...(res.dropped ? { dropped: res.dropped } : { action: res.action, number: res.number }) });
}

// an agent uploads one file: POST the raw bytes to /api/attachments?org=…&name=…&type=…&ticket=…  (up to 5 MB; it waits unattached until a reply claims it)
export async function attachmentUpload(req, { pool, auth, store }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const u = new URL(req.url), orgId = String(u.searchParams.get('org') || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  if (Number(req.headers.get('content-length') || 0) > MAX_UPLOAD + 1024) return json(413, { error: 'Files can be up to 5 MB each.' });
  const bytes = Buffer.from(await req.arrayBuffer());
  const r = await saveUpload(pool, store, orgId, { id: s.user.id }, { filename: u.searchParams.get('name'), contentType: u.searchParams.get('type') || req.headers.get('content-type'), bytes, ticketNumber: u.searchParams.get('ticket') });
  return r.ok ? json(200, r) : json(r.status || 400, { error: r.error });
}
// a file is always downloaded, never shown inside our pages, and the browser may not guess its type
export async function attachmentDownload(req, { pool, auth, store }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const u = new URL(req.url), orgId = String(u.searchParams.get('org') || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  const f = await readFile(pool, store, orgId, u.pathname.split('/').pop()); if (!f) return json(404, { error: 'No such file.' });
  return new Response(f.bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${cleanName(f.filename).replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(cleanName(f.filename))}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store', 'Content-Length': String(f.bytes.length) } });
}
export const _json = json;
