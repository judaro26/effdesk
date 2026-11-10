// src/portal.js: THE CUSTOMER PORTAL: a requester signs in with a link sent to their email (no password), sees their own tickets, replies and logs out.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { addRequesterMessage } from './tickets.js';

export const COOKIE = 'eff_portal', SESSION_SECONDS = 12 * 3600, LINK_MINUTES = 30;
const secret = env => String(env.PORTAL_SECRET || env.BETTER_AUTH_SECRET || '');
const mac = (env, s) => crypto.createHmac('sha256', secret(env)).update(s).digest('base64url');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export const sessionCookie = (env, orgId, email, now = Date.now()) => { const p = Buffer.from(JSON.stringify({ o: orgId, e: email, x: Math.floor(now / 1000) + SESSION_SECONDS })).toString('base64url'); return `${p}.${mac(env, 'session:' + p)}`; };
export function readSession(env, cookie, orgId, now = Date.now()) {
  try { if (!secret(env) || !cookie) return null; const [p, m] = String(cookie).split('.'); if (!p || !m || !eq(m, mac(env, 'session:' + p))) return null; const v = JSON.parse(Buffer.from(p, 'base64url').toString()); return v.o === orgId && v.x > now / 1000 && /@/.test(v.e) ? { email: v.e } : null; } catch { return null; }
}
export const csrfFor = (env, cookie) => mac(env, 'csrf:' + String(cookie || ''));
export const csrfOk = (env, cookie, token) => !!cookie && !!token && eq(token, csrfFor(env, cookie));

// A link is sent only to an address that already has a ticket here (so the form cannot be used to mail strangers), at most 5 an hour per address and 200 an hour per organization. The caller always answers the same way.
export async function requestLink(pool, orgId, email, now = Date.now()) {
  const addr = String(email || '').trim().toLowerCase(); if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 254) return null;
  return withOrg(pool, orgId, async c => {
    if (!(await c.query('select 1 from tickets where org_id = $1 and requester_email = $2 limit 1', [orgId, addr])).rowCount) return null;
    if ((await c.query("select count(*)::int n from portal_links where org_id = $1 and email = $2 and created_at > now() - interval '1 hour'", [orgId, addr])).rows[0].n >= 5) return null;
    if ((await c.query("select count(*)::int n from portal_links where org_id = $1 and created_at > now() - interval '1 hour'", [orgId])).rows[0].n >= 200) return null;
    const token = crypto.randomBytes(24).toString('base64url');
    await c.query('insert into portal_links (token_hash, org_id, email, expires_at) values ($1,$2,$3, now() + ($4 || \' minutes\')::interval)', [sha(token), orgId, addr, String(LINK_MINUTES)]);
    return { token, email: addr };
  });
}
export async function consumeLink(pool, orgId, token) {
  return withOrg(pool, orgId, async c => (await c.query('update portal_links set used_at = now() where org_id = $1 and token_hash = $2 and used_at is null and expires_at > now() returning email', [orgId, sha(String(token || ''))])).rows[0]?.email || null);
}
export async function myTickets(pool, orgId, email) { return withOrg(pool, orgId, async c => (await c.query('select number, subject, status, updated_at from tickets where org_id = $1 and requester_email = $2 order by updated_at desc limit 100', [orgId, email])).rows); }
// the requester sees public messages only (never internal notes)
export async function myTicket(pool, orgId, email, number) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, number, subject, status, created_at from tickets where org_id = $1 and number = $2 and requester_email = $3', [orgId, Number(number) || 0, email])).rows[0]; if (!t) return null;
    const messages = (await c.query("select id, kind, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = $2 and kind in ('requester','agent') order by created_at, id", [orgId, t.id])).rows;
    const files = (await c.query('select id, message_id, filename, size from attachments where org_id = $1 and ticket_id = $2 and message_id is not null', [orgId, t.id])).rows;
    for (const m of messages) m.files = files.filter(f => f.message_id === m.id);
    return { ticket: t, messages };
  });
}
export async function myReply(pool, orgId, email, number, body, name) {
  const t = await myTicket(pool, orgId, email, number); if (!t) return { ok: false, status: 404 };
  const r = await addRequesterMessage(pool, orgId, number, { body, authorName: name || email });
  return r.closed ? { ok: false, status: 409, closed: true } : r;
}
