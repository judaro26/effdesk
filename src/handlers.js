// src/handlers.js: THE API, as plain functions of (Request, deps) → Response, so the tests can call them without Netlify. The files in netlify/functions only wire these to addresses.
import { PRODUCT, platformAdmins } from './config.js';
import { getEntitlements, seatsUsed, checkoutConfig, verifySignature, applyPaddleEvent } from './billing.js';
import { grantLicense, revokeLicense } from './license.js';
import { withOrg } from './db.js';

const json = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(extra || {}) } });
const readJson = async req => { try { const t = await req.text(); if (t.length > 10000) return null; const v = JSON.parse(t || '{}'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
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
export const _json = json;
