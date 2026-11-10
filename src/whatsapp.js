// src/whatsapp.js: WHATSAPP (Meta's WhatsApp Business Cloud API). An admin enters the phone number ID, an access token and the app secret from their Meta app, and gives Meta this address as the webhook. A customer's message then becomes a ticket with the channel "whatsapp" (or joins their open one), agents reply from the desk, and Meta's delivery reports (sent, delivered, read, failed) are kept for every message the agents send.
//   Meta lets a business send free-form text only within 24 hours of the customer's last message; after that the reply is refused here, before anything is saved, so the agent can keep the text.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { seal, unseal } from './sso.js';
import { createTicket, addRequesterMessage } from './tickets.js';
import { getEntitlements } from './billing.js';
import { has as planHas } from './plans.js';
import { emit } from './webhooks.js';
import { notifyTicket } from './notify.js';

const GRAPH = 'https://graph.facebook.com/v21.0';
const WINDOW_MS = 24 * 3600 * 1000;
const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400) => ({ ok: false, status, error });
const digits = v => String(v || '').replace(/\D/g, '').slice(0, 20);
export const placeholderEmail = phone => `${digits(phone)}@whatsapp.invalid`;
const sk = env => String(env.BETTER_AUTH_SECRET || '');
const cols = 'org_id, enabled, phone_number_id, display_phone, access_token_enc, app_secret_enc, verify_token';

export async function getAccount(pool, orgId) { return (await pool.query(`select ${cols} from whatsapp_accounts where org_id = $1`, [orgId])).rows[0] || null; }
const publicView = (row, base) => row ? { enabled: row.enabled, phoneNumberId: row.phone_number_id, displayPhone: row.display_phone, verifyToken: row.verify_token, hasToken: true, webhookUrl: base ? base + '/api/webhooks/whatsapp' : '/api/webhooks/whatsapp' } : { enabled: false, phoneNumberId: '', displayPhone: '', verifyToken: '', hasToken: false, webhookUrl: base ? base + '/api/webhooks/whatsapp' : '/api/webhooks/whatsapp' };
export async function getSettings(pool, env, orgId, base) { return publicView(await getAccount(pool, orgId), base); }
export async function saveSettings(pool, env, orgId, input, base) {
  const old = await getAccount(pool, orgId);
  const pid = digits(input.phoneNumberId), token = clean(input.accessToken, 1000), app = clean(input.appSecret, 200);
  if (!pid) return fail('Enter the phone number ID from your Meta app.');
  if (!old && !token) return fail('Enter the access token from your Meta app.');
  if (!old && !app) return fail('Enter the app secret from your Meta app.');
  if (!sk(env)) return fail('The server has no secret to protect the token with.', 500);
  const verify = old ? old.verify_token : crypto.randomBytes(18).toString('hex');
  const clash = (await pool.query('select 1 from whatsapp_accounts where phone_number_id = $1 and org_id <> $2', [pid, orgId])).rowCount;
  if (clash) return fail('That WhatsApp number is already connected to another workspace.', 409);
  const row = { enabled: input.enabled === true, display_phone: clean(input.displayPhone, 40), access_token_enc: token ? seal(sk(env), token) : old.access_token_enc, app_secret_enc: app ? seal(sk(env), app) : old.app_secret_enc };
  await pool.query('insert into whatsapp_accounts (org_id, enabled, phone_number_id, display_phone, access_token_enc, app_secret_enc, verify_token) values ($1,$2,$3,$4,$5,$6,$7) on conflict (org_id) do update set enabled = $2, phone_number_id = $3, display_phone = $4, access_token_enc = $5, app_secret_enc = $6, updated_at = now()', [orgId, row.enabled, pid, row.display_phone, row.access_token_enc, row.app_secret_enc, verify]);
  return { ok: true, settings: publicView(await getAccount(pool, orgId), base) };
}
export async function deleteAccount(pool, orgId) { await pool.query('delete from whatsapp_accounts where org_id = $1', [orgId]); return { ok: true }; }

// Meta checks the webhook address once with a GET carrying the verify token we showed the admin
export async function verifyChallenge(pool, query) {
  if (query.get('hub.mode') !== 'subscribe') return null;
  const tok = String(query.get('hub.verify_token') || ''); if (!tok) return null;
  const r = await pool.query('select 1 from whatsapp_accounts where verify_token = $1', [tok]);
  return r.rowCount ? String(query.get('hub.challenge') || '') : null;
}
const sigOk = (secret, raw, header) => { const want = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex'), a = Buffer.from(want), b = Buffer.from(String(header || '')); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const textOf = m => m.type === 'text' ? (m.text && m.text.body) : m.type === 'button' ? (m.button && m.button.text) : m.type === 'interactive' ? ((m.interactive && ((m.interactive.button_reply && m.interactive.button_reply.title) || (m.interactive.list_reply && m.interactive.list_reply.title))) || '') : m.type === 'image' || m.type === 'video' || m.type === 'audio' || m.type === 'document' || m.type === 'sticker' ? `[${m.type} received. Open it in WhatsApp: ${m.type === 'document' && m.document && m.document.filename ? m.document.filename : 'attachments are not copied into the desk yet'}]` : m.type === 'location' ? `[Location: ${m.location && m.location.latitude}, ${m.location && m.location.longitude}]` : `[${m.type || 'unsupported'} message]`;

// Meta's call. `raw` is the exact body (the signature covers it). Always answers 200 for a body that is ours so Meta does not retry forever.
export async function handleWebhook(pool, env, raw, signature, mailer) {
  let ev; try { ev = JSON.parse(raw); } catch { return fail('Not JSON.'); }
  let handled = 0;
  for (const entry of (ev && ev.entry) || []) for (const ch of (entry.changes || [])) {
    const v = ch.value || {}, pid = v.metadata && v.metadata.phone_number_id; if (!pid) continue;
    const acc = (await pool.query(`select ${cols} from whatsapp_accounts where phone_number_id = $1`, [String(pid)])).rows[0];
    if (!acc || !acc.enabled) continue;
    let secret; try { secret = unseal(sk(env), acc.app_secret_enc); } catch { continue; }
    if (!sigOk(secret, raw, signature)) return fail('Bad signature.', 401);
    if (!planHas(await getEntitlements(pool, acc.org_id), 'whatsapp')) continue;
    const names = {}; for (const c of v.contacts || []) names[c.wa_id] = c.profile && c.profile.name;
    for (const m of v.messages || []) { try { handled += await receive(pool, acc.org_id, m, names[m.from], mailer); } catch (e) { console.error('whatsapp receive failed', e && e.message); } }
    for (const s of v.statuses || []) { try { await status(pool, acc.org_id, s); } catch (e) { console.error('whatsapp status failed', e && e.message); } }
  }
  return { ok: true, handled };
}
async function receive(pool, orgId, m, name, mailer) {
  const phone = digits(m.from), body = clean(textOf(m), 4000); if (!phone || !m.id || !body) return 0;
  const fresh = await withOrg(pool, orgId, async c => (await c.query("insert into whatsapp_messages (org_id, wamid, direction, status) values ($1,$2,'in','received') on conflict do nothing returning wamid", [orgId, m.id])).rowCount);
  if (!fresh) return 0;                                    // Meta repeats a call it thinks was missed
  const open = await withOrg(pool, orgId, async c => (await c.query("select number from tickets where org_id = $1 and requester_phone = $2 and channel = 'whatsapp' and status <> 'closed' order by updated_at desc limit 1", [orgId, phone])).rows[0]);
  let number;
  if (open) { const r = await addRequesterMessage(pool, orgId, open.number, { body, authorName: name || '+' + phone }); if (!r.ok) return 0; number = open.number; await emit(pool, orgId, 'message.customer', number, { message: { body: body.slice(0, 2000) } }); }
  else {
    const r = await createTicket(pool, orgId, null, { subject: 'WhatsApp: ' + body.replace(/\s+/g, ' ').slice(0, 60), body, requesterEmail: placeholderEmail(phone), requesterName: name || '+' + phone, channel: 'whatsapp' });
    if (!r.ok) return 0; number = r.ticket.number;
    await withOrg(pool, orgId, c => c.query('update tickets set requester_phone = $3 where org_id = $1 and number = $2', [orgId, number, phone]));
    await emit(pool, orgId, 'ticket.created', number);
  }
  await withOrg(pool, orgId, c => c.query('update whatsapp_messages set ticket_id = (select id from tickets where org_id = $1 and number = $3) where org_id = $1 and wamid = $2', [orgId, m.id, number]));
  if (mailer) { try { await notifyTicket(pool, mailer, orgId, number, { kind: 'reply', summary: body.slice(0, 300) }); } catch { } }
  return 1;
}
async function status(pool, orgId, s) {
  const st = ['sent', 'delivered', 'read', 'failed'].includes(s.status) ? s.status : null; if (!st || !s.id) return;
  const err = s.errors && s.errors[0] ? clean(s.errors[0].title || s.errors[0].message || s.errors[0].code, 300) : null;
  const rank = { sent: 1, delivered: 2, read: 3, failed: 9 };
  await withOrg(pool, orgId, async c => {
    const cur = (await c.query("select status from whatsapp_messages where org_id = $1 and wamid = $2 and direction = 'out'", [orgId, s.id])).rows[0]; if (!cur) return;
    if ((rank[cur.status] || 0) > (rank[st] || 0) && cur.status !== 'failed') return;   // reports can arrive out of order: never go from read back to delivered
    await c.query('update whatsapp_messages set status = $3, error = $4, updated_at = now() where org_id = $1 and wamid = $2', [orgId, s.id, st, st === 'failed' ? err : null]);
  });
}

// the customer's last message time, to know whether Meta will still accept free text
export async function windowState(pool, orgId, number) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query("select id, channel, requester_phone from tickets where org_id = $1 and number = $2", [orgId, Number(number) || 0])).rows[0];
    if (!t || t.channel !== 'whatsapp') return null;
    const last = (await c.query("select max(created_at) as at from ticket_messages where org_id = $1 and ticket_id = $2 and kind = 'requester'", [orgId, t.id])).rows[0].at;
    return { ticketId: t.id, phone: t.requester_phone, open: !!last && Date.now() - new Date(last).getTime() < WINDOW_MS };
  });
}
// send an agent's message; returns { delivery: 'sent'|'failed'|'skipped', why }
export async function sendReply(pool, env, orgId, number, messageId, body, fetchFn = fetch) {
  const w = await windowState(pool, orgId, number); if (!w) return { delivery: 'skipped', why: 'not-whatsapp' };
  const acc = await getAccount(pool, orgId); if (!acc || !acc.enabled) return { delivery: 'skipped', why: 'no-account' };
  let token; try { token = unseal(sk(env), acc.access_token_enc); } catch { return { delivery: 'failed', why: 'token' }; }
  const record = (wamid, st, err) => withOrg(pool, orgId, c => c.query("insert into whatsapp_messages (org_id, wamid, ticket_id, message_id, direction, status, error) values ($1,$2,$3,$4,'out',$5,$6) on conflict (org_id, wamid) do nothing", [orgId, wamid, w.ticketId, messageId, st, err || null]));
  try {
    const r = await fetchFn(`${GRAPH}/${acc.phone_number_id}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: w.phone, type: 'text', text: { body: String(body).slice(0, 4000), preview_url: false } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const msg = clean(j.error && (j.error.error_user_msg || j.error.message), 300) || 'WhatsApp answered ' + r.status; await record('fail:' + crypto.randomUUID(), 'failed', msg); return { delivery: 'failed', why: msg }; }
    const wamid = j.messages && j.messages[0] && j.messages[0].id; if (wamid) await record(wamid, 'sent');
    return { delivery: 'sent' };
  } catch (e) { const msg = 'Could not reach WhatsApp.'; await record('fail:' + crypto.randomUUID(), 'failed', msg).catch(() => { }); return { delivery: 'failed', why: msg }; }
}
// delivery state per agent message of a ticket, for the conversation view
export async function deliveryOf(pool, orgId, number) {
  return withOrg(pool, orgId, async c => (await c.query("select w.message_id, w.status, w.error from whatsapp_messages w join tickets t on t.id = w.ticket_id and t.org_id = w.org_id where w.org_id = $1 and t.number = $2 and w.direction = 'out' and w.message_id is not null", [orgId, Number(number) || 0])).rows);
}
