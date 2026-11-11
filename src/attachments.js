// src/attachments.js: FILES ON TICKETS: an agent's upload, the files of an incoming email, listing, download, and the per-plan storage limit.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { getEntitlements } from './billing.js';

export const MAX_UPLOAD = 5 * 1024 * 1024;               // one file from an agent (the function request limit is 6 MB)
export const MAX_INBOUND_FILE = 10 * 1024 * 1024, MAX_INBOUND_TOTAL = 25 * 1024 * 1024;
export const MAX_PER_REPLY = 5;
export const STORAGE_BYTES = { free: 500e6, team: 5e9, suite: 20e9, pro: 100e9 };
const SAFE_INLINE = new Set();                            // nothing is shown inside our pages: every download is an attachment
export const cleanName = n => { const s = String(n || 'file').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]+/g, '_').replace(/^\.+/, '').trim().slice(0, 150); return s || 'file'; };
const cleanType = t => /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(t || '').split(';')[0].trim()) ? String(t).split(';')[0].trim().toLowerCase() : 'application/octet-stream';
const fail = (error, status = 400) => ({ ok: false, status, error });
const limitFor = ent => ent.storageBytes ? ent.storageBytes : ent.license ? STORAGE_BYTES.pro : STORAGE_BYTES[ent.plan] || STORAGE_BYTES.free;
export async function storageUsed(pool, orgId) { return withOrg(pool, orgId, async c => Number((await c.query('select coalesce(sum(size),0)::bigint n from attachments where org_id = $1', [orgId])).rows[0].n)); }

// bytes in, an index row out (the row waits, with no message, until a reply claims it)
export async function saveUpload(pool, store, orgId, actor, { filename, contentType, bytes, ticketNumber }) {
  if (!bytes || !bytes.length) return fail('That file is empty.');
  if (bytes.length > MAX_UPLOAD) return fail('Files can be up to 5 MB each.', 413);
  const ent = await getEntitlements(pool, orgId);
  if ((await storageUsed(pool, orgId)) + bytes.length > limitFor(ent)) return fail('Your storage for files is full. Delete files or upgrade.', 402);
  const id = crypto.randomUUID(), name = cleanName(filename), type = cleanType(contentType);
  const t = ticketNumber ? await withOrg(pool, orgId, async c => (await c.query('select id from tickets where org_id = $1 and number = $2', [orgId, Number(ticketNumber) || 0])).rows[0]) : null;
  if (ticketNumber && !t) return fail('No such ticket.', 404);
  await store.set(`${orgId}/${id}`, bytes);
  await withOrg(pool, orgId, c => c.query('insert into attachments (id, org_id, ticket_id, filename, content_type, size, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7)', [id, orgId, t ? t.id : null, name, type, bytes.length, actor ? actor.id : null]));
  return { ok: true, attachment: { id, filename: name, contentType: type, size: bytes.length } };
}
// an agent's uploads become the files of a reply (only the agent's own, unclaimed uploads, on this ticket)
export async function claimUploads(pool, orgId, actor, ticketNumber, messageRowId, ids) {
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, MAX_PER_REPLY); if (!list.length) return [];
  return withOrg(pool, orgId, async c => (await c.query(`update attachments set message_id = $3, ticket_id = (select id from tickets where org_id = $1 and number = $2) where org_id = $1 and id = any($4::text[]) and message_id is null and uploaded_by = $5 and (ticket_id is null or ticket_id = (select id from tickets where org_id = $1 and number = $2)) returning id, filename, content_type, size`, [orgId, Number(ticketNumber) || 0, messageRowId, list, actor.id])).rows);
}
export async function filesOfMessage(pool, orgId, messageRowId) { return withOrg(pool, orgId, async c => (await c.query('select id, filename, content_type, size from attachments where org_id = $1 and message_id = $2 order by created_at', [orgId, messageRowId])).rows); }
export async function filesOfTicket(pool, orgId, ticketId) { return withOrg(pool, orgId, async c => (await c.query('select id, message_id, filename, content_type, size from attachments where org_id = $1 and ticket_id = $2 and message_id is not null order by created_at', [orgId, ticketId])).rows); }
export async function readFile(pool, store, orgId, id) {
  const row = await withOrg(pool, orgId, async c => (await c.query('select id, filename, content_type, size from attachments where org_id = $1 and id = $2', [orgId, String(id)])).rows[0]);
  if (!row) return null; const bytes = await store.get(`${orgId}/${row.id}`); return bytes ? { ...row, bytes } : null;
}
export async function deleteFile(pool, store, orgId, id) {
  const gone = await withOrg(pool, orgId, async c => (await c.query('delete from attachments where org_id = $1 and id = $2 returning id', [orgId, String(id)])).rowCount);
  if (gone) await store.delete(`${orgId}/${id}`); return gone > 0;
}
// the files of an incoming email (Resend lists them with a short-lived download link). Returns what could not be kept, so the ticket can say so.
export async function storeInbound(pool, store, fetchFn, env, orgId, ticketNumber, messageRowId, emailId) {
  const skipped = [];
  try {
    const r = await fetchFn(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments?limit=20`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!r.ok) throw new Error('status ' + r.status);
    const list = (await r.json()).data || [], ent = await getEntitlements(pool, orgId), room = limitFor(ent); let total = 0, used = await storageUsed(pool, orgId);
    const ticket = await withOrg(pool, orgId, async c => (await c.query('select id from tickets where org_id = $1 and number = $2', [orgId, ticketNumber])).rows[0]);
    for (const a of list) {
      const name = cleanName(a.filename);
      try {
        if (a.size > MAX_INBOUND_FILE || total + a.size > MAX_INBOUND_TOTAL) { skipped.push(`${name} (too large)`); continue; }
        if (used + a.size > room) { skipped.push(`${name} (storage full)`); continue; }
        const d = await fetchFn(a.download_url); if (!d.ok) throw new Error('download ' + d.status);
        const bytes = Buffer.from(await d.arrayBuffer()); if (bytes.length > MAX_INBOUND_FILE) { skipped.push(`${name} (too large)`); continue; }
        const id = crypto.randomUUID(); await store.set(`${orgId}/${id}`, bytes); total += bytes.length; used += bytes.length;
        await withOrg(pool, orgId, c => c.query('insert into attachments (id, org_id, ticket_id, message_id, filename, content_type, size) values ($1,$2,$3,$4,$5,$6,$7)', [id, orgId, ticket.id, messageRowId, name, cleanType(a.content_type), bytes.length]));
      } catch (e) { console.warn('attachment not stored:', e.message); skipped.push(`${name} (could not be fetched)`); }
    }
  } catch (e) { console.warn('attachments not listed:', e.message); skipped.push('attachments (could not be fetched)'); }
  if (skipped.length) await withOrg(pool, orgId, c => c.query("insert into ticket_messages (org_id, ticket_id, kind, body) select $1, id, 'system', $3 from tickets where org_id = $1 and number = $2", [orgId, ticketNumber, `Not stored: ${skipped.join(', ')}.`]));
  return skipped;
}

// one file that arrived with a customer's message by some route other than email (WhatsApp media): same size and storage rules as email attachments; returns { ok, id } or { ok: false, why }
export async function storeBytes(pool, store, orgId, ticketNumber, messageRowId, { filename, contentType, bytes }) {
  const name = cleanName(filename);
  if (bytes.length > MAX_INBOUND_FILE) return { ok: false, why: `${name} (too large)` };
  const ent = await getEntitlements(pool, orgId); if (await storageUsed(pool, orgId) + bytes.length > limitFor(ent)) return { ok: false, why: `${name} (storage full)` };
  const ticket = await withOrg(pool, orgId, async c => (await c.query('select id from tickets where org_id = $1 and number = $2', [orgId, ticketNumber])).rows[0]); if (!ticket) return { ok: false, why: 'no ticket' };
  const id = crypto.randomUUID(); await store.set(`${orgId}/${id}`, bytes);
  await withOrg(pool, orgId, c => c.query('insert into attachments (id, org_id, ticket_id, message_id, filename, content_type, size) values ($1,$2,$3,$4,$5,$6,$7)', [id, orgId, ticket.id, messageRowId, name, cleanType(contentType), bytes.length]));
  return { ok: true, id };
}
