// src/whatsapp.js: WHATSAPP (Meta's WhatsApp Business Cloud API). An admin enters the phone number ID, an access token and the app secret from their Meta app, and gives Meta this address as the webhook. A customer's message then becomes a ticket with the channel "whatsapp" (or joins their open one), agents reply from the desk, and Meta's delivery reports (sent, delivered, read, failed) are kept for every message the agents send.
//   Meta lets a business send free-form text only within 24 hours of the customer's last message; after that the reply is refused here, before anything is saved, so the agent can keep the text.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { seal, unseal } from './sso.js';
import { createTicket, addRequesterMessage, addMessage } from './tickets.js';
import { storeBytes } from './attachments.js';
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
const MEDIA = { image: 'Photo', video: 'Video', audio: 'Voice message', voice: 'Voice message', document: 'Document', sticker: 'Sticker' };
const mediaOf = m => MEDIA[m.type] && m[m.type] && m[m.type].id ? { id: m[m.type].id, kind: m.type, filename: m.type === 'document' ? m.document.filename : null, mime: m[m.type].mime_type, caption: m[m.type].caption || '' } : null;
const textOf = m => { const md = mediaOf(m); return m.type === 'text' ? (m.text && m.text.body) : m.type === 'button' ? (m.button && m.button.text) : m.type === 'interactive' ? ((m.interactive && ((m.interactive.button_reply && m.interactive.button_reply.title) || (m.interactive.list_reply && m.interactive.list_reply.title))) || '') : md ? (md.caption || `[${MEDIA[md.kind]}]`) : m.type === 'location' ? `[Location: ${m.location && m.location.latitude}, ${m.location && m.location.longitude}]` : `[${m.type || 'unsupported'} message]`; };
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'application/pdf': 'pdf' };
// download what the customer sent (Meta gives a short-lived address for the media id) and keep it on the message; says so on the ticket when it could not be kept
async function keepMedia(pool, store, fetchFn, token, orgId, number, messageRowId, md) {
  let why = '';
  try {
    const meta = await fetchFn(`${GRAPH}/${encodeURIComponent(md.id)}`, { headers: { Authorization: 'Bearer ' + token } }); if (!meta.ok) throw new Error('lookup ' + meta.status);
    const info = await meta.json(); if (!info.url) throw new Error('no address');
    if (Number(info.file_size) > 10 * 1024 * 1024) why = 'too large';
    else {
      const f = await fetchFn(info.url, { headers: { Authorization: 'Bearer ' + token } }); if (!f.ok) throw new Error('download ' + f.status);
      const bytes = Buffer.from(await f.arrayBuffer()), mime = String(info.mime_type || md.mime || '').split(';')[0];
      const r = await storeBytes(pool, store, orgId, number, messageRowId, { filename: md.filename || `${md.kind}-${md.id.slice(-6)}.${EXT[mime] || 'bin'}`, contentType: mime, bytes });
      if (!r.ok) why = r.why.replace(/^.*\((.*)\)$/, '$1');
    }
  } catch (e) { console.warn('whatsapp media not kept:', e.message); why = 'could not be fetched'; }
  if (why) await withOrg(pool, orgId, async c => { const t = (await c.query('select id from tickets where org_id = $1 and number = $2', [orgId, number])).rows[0]; if (t) await c.query("insert into ticket_messages (org_id, ticket_id, kind, author_name, body) values ($1,$2,'system','WhatsApp',$3)", [orgId, t.id, `The ${MEDIA[md.kind].toLowerCase()} could not be saved here (${why}). Open it in WhatsApp.`]); });
}

// Meta's call. `raw` is the exact body (the signature covers it). Always answers 200 for a body that is ours so Meta does not retry forever.
export async function handleWebhook(pool, env, raw, signature, mailer, { store, fetchFn = fetch } = {}) {
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
    for (const m of v.messages || []) { try { handled += await receive(pool, acc.org_id, m, names[m.from], mailer, store, fetchFn, unseal(sk(env), acc.access_token_enc)); } catch (e) { console.error('whatsapp receive failed', e && e.message); } }
    for (const s of v.statuses || []) { try { await status(pool, acc.org_id, s); } catch (e) { console.error('whatsapp status failed', e && e.message); } }
  }
  return { ok: true, handled };
}
async function receive(pool, orgId, m, name, mailer, store, fetchFn, token) {
  const phone = digits(m.from), body = clean(textOf(m), 4000); if (!phone || !m.id || !body) return 0;
  const fresh = await withOrg(pool, orgId, async c => (await c.query("insert into whatsapp_messages (org_id, wamid, direction, status) values ($1,$2,'in','received') on conflict do nothing returning wamid", [orgId, m.id])).rowCount);
  if (!fresh) return 0;                                    // Meta repeats a call it thinks was missed
  const open = await withOrg(pool, orgId, async c => (await c.query("select number from tickets where org_id = $1 and requester_phone = $2 and channel = 'whatsapp' and status <> 'closed' order by updated_at desc limit 1", [orgId, phone])).rows[0]);
  let number, rowId;
  if (open) { const r = await addRequesterMessage(pool, orgId, open.number, { body, authorName: name || '+' + phone }); if (!r.ok) return 0; number = open.number; rowId = r.messageRowId; await emit(pool, orgId, 'message.customer', number, { message: { body: body.slice(0, 2000) } }); }
  else {
    const r = await createTicket(pool, orgId, null, { subject: 'WhatsApp: ' + body.replace(/\s+/g, ' ').slice(0, 60), body, requesterEmail: placeholderEmail(phone), requesterName: name || '+' + phone, channel: 'whatsapp' });
    if (!r.ok) return 0; number = r.ticket.number; rowId = r.messageRowId;
    await withOrg(pool, orgId, c => c.query('update tickets set requester_phone = $3 where org_id = $1 and number = $2', [orgId, number, phone]));
    await emit(pool, orgId, 'ticket.created', number);
  }
  await withOrg(pool, orgId, c => c.query('update whatsapp_messages set ticket_id = (select id from tickets where org_id = $1 and number = $3) where org_id = $1 and wamid = $2', [orgId, m.id, number]));
  const md = mediaOf(m); if (md && store && rowId) await keepMedia(pool, store, fetchFn, token, orgId, number, rowId, md);
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

// ---- message templates: the texts Meta has approved for this number (the admin lists them here), the only thing a business may send after 24 hours of silence ----
const slots = body => Math.max(0, ...[...String(body).matchAll(/\{\{(\d+)\}\}/g)].map(x => Number(x[1])));
const fill = (body, params) => String(body).replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] || '');
export async function listTemplates(pool, orgId) { return withOrg(pool, orgId, async c => (await c.query('select name, language, body from whatsapp_templates where org_id = $1 order by name, language', [orgId])).rows.map(t => ({ ...t, slots: slots(t.body) }))); }
export async function saveTemplate(pool, orgId, input) {
  const name = clean(input.name, 100).toLowerCase(), language = clean(input.language, 12) || 'en_US', body = clean(input.body, 1024);
  if (!/^[a-z0-9_]{1,100}$/.test(name)) return fail('Use the template name exactly as it is in Meta: lowercase letters, numbers and underscores.');
  if (!/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/.test(language)) return fail('Use the language code from Meta, for example en_US or es.');
  if (!body) return fail('Paste the template text as approved, with {{1}}, {{2}} where the variables go.');
  const n = slots(body); if (n > 10) return fail('A template can have at most 10 variables.');
  await withOrg(pool, orgId, c => c.query('insert into whatsapp_templates (org_id, name, language, body) values ($1,$2,$3,$4) on conflict (org_id, name, language) do update set body = $4, updated_at = now()', [orgId, name, language, body]));
  return { ok: true, templates: await listTemplates(pool, orgId) };
}
export async function deleteTemplate(pool, orgId, name, language) { await withOrg(pool, orgId, c => c.query('delete from whatsapp_templates where org_id = $1 and name = $2 and language = $3', [orgId, String(name || ''), String(language || '')])); return { ok: true, templates: await listTemplates(pool, orgId) }; }
// an agent sends a template to the customer of a WhatsApp ticket (allowed at any time); the filled-in text is saved as the agent's message
export async function sendTemplate(pool, env, orgId, actor, number, input, fetchFn = fetch) {
  const w = await windowState(pool, orgId, number); if (!w) return fail('This is not a WhatsApp ticket.', 400);
  const tpl = (await listTemplates(pool, orgId)).find(t => t.name === input.name && t.language === input.language); if (!tpl) return fail('No such template. Ask an admin to add it under Manage > WhatsApp.', 404);
  const params = (Array.isArray(input.params) ? input.params : []).map(x => clean(x, 200));
  if (params.slice(0, tpl.slots).filter(Boolean).length < tpl.slots) return fail('Fill in every variable of the template.');
  const text = fill(tpl.body, params);
  const acc = await getAccount(pool, orgId); if (!acc || !acc.enabled) return fail('WhatsApp is switched off.', 409);
  let token; try { token = unseal(sk(env), acc.access_token_enc); } catch { return fail('The saved access token cannot be read. Enter it again.', 500); }
  const added = await addMessage(pool, orgId, actor, number, { body: text, internal: false, status: input.status }); if (!added.ok) return added;
  const record = (wamid, st, err) => withOrg(pool, orgId, c => c.query("insert into whatsapp_messages (org_id, wamid, ticket_id, message_id, direction, status, error) values ($1,$2,$3,$4,'out',$5,$6) on conflict (org_id, wamid) do nothing", [orgId, wamid, w.ticketId, added.message.id, st, err || null]));
  try {
    const r = await fetchFn(`${GRAPH}/${acc.phone_number_id}/messages`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ messaging_product: 'whatsapp', to: w.phone, type: 'template', template: { name: tpl.name, language: { code: tpl.language }, ...(tpl.slots ? { components: [{ type: 'body', parameters: params.slice(0, tpl.slots).map(t => ({ type: 'text', text: t })) }] } : {}) } }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const msg = clean(j.error && (j.error.error_user_msg || j.error.message), 300) || 'WhatsApp answered ' + r.status; await record('fail:' + crypto.randomUUID(), 'failed', msg); return { ...added, whatsapp: 'failed', whatsappWhy: msg }; }
    const wamid = j.messages && j.messages[0] && j.messages[0].id; if (wamid) await record(wamid, 'sent');
    return { ...added, whatsapp: 'sent' };
  } catch { await record('fail:' + crypto.randomUUID(), 'failed', 'Could not reach WhatsApp.').catch(() => { }); return { ...added, whatsapp: 'failed', whatsappWhy: 'Could not reach WhatsApp.' }; }
}
