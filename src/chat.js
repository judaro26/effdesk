// src/chat.js: LIVE CHAT. A visitor on the customer's website opens the chat widget, gives a name and email and a first message, and a ticket with the channel "chat" is created. The visitor's page polls for the agents' replies. The agents answer from the desk as with any ticket; while the visitor's chat window is open the reply appears there, and when it is closed the reply is emailed as usual.
//   a visitor proves it is theirs chat with a token only they were given (a signature of the ticket number); nothing else is public.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { createTicket, addRequesterMessage } from './tickets.js';
import { getEntitlements } from './billing.js';
import { has as planHas } from './plans.js';
import { emit } from './webhooks.js';
import { notifyTicket } from './notify.js';

const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400) => ({ ok: false, status, error });
const secret = env => String(env.EMAIL_TOKEN_SECRET || env.BETTER_AUTH_SECRET || '');
export const chatToken = (env, orgId, number) => crypto.createHmac('sha256', secret(env)).update(`chat:${orgId}:${number}`).digest('hex').slice(0, 24);
const tokenOk = (env, orgId, number, tok) => { const a = Buffer.from(chatToken(env, orgId, number)), b = Buffer.from(String(tok || '')); return !!secret(env) && a.length === b.length && crypto.timingSafeEqual(a, b); };
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
export const DEFAULTS = { enabled: false, title: 'Chat with us', greeting: 'Hi! Ask us anything. We reply here, and by email if you leave.', color: '#1f73b7' };

export async function getSettings(pool, orgId) {
  return withOrg(pool, orgId, async c => { const r = (await c.query('select enabled, title, greeting, color from chat_settings where org_id = $1', [orgId])).rows[0]; return { ...DEFAULTS, ...(r || {}) }; });
}
export async function saveSettings(pool, orgId, input) {
  const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || '')) ? input.color : DEFAULTS.color, title = clean(input.title, 60) || DEFAULTS.title, greeting = clean(input.greeting, 300) || DEFAULTS.greeting, enabled = input.enabled === true;
  await withOrg(pool, orgId, c => c.query('insert into chat_settings (org_id, enabled, title, greeting, color) values ($1,$2,$3,$4,$5) on conflict (org_id) do update set enabled = $2, title = $3, greeting = $4, color = $5, updated_at = now()', [orgId, enabled, title, greeting, color]));
  return { ok: true, settings: { enabled, title, greeting, color } };
}
async function orgOf(pool, slug) { return (await pool.query('select id, name, slug from "organization" where slug = $1', [String(slug || '').toLowerCase().slice(0, 60)])).rows[0] || null; }
// the widget may run only where the plan includes live chat and the agents turned it on
async function liveOrg(pool, slug) {
  const org = await orgOf(pool, slug); if (!org) return null;
  if (!planHas(await getEntitlements(pool, org.id), 'live_chat')) return null;
  const s = await getSettings(pool, org.id); return s.enabled ? { org, settings: s } : null;
}
export async function publicConfig(pool, slug) { const x = await liveOrg(pool, slug); return x ? { ok: true, enabled: true, name: x.org.name, title: x.settings.title, greeting: x.settings.greeting, color: x.settings.color } : { ok: true, enabled: false }; }

export async function startChat(pool, env, slug, input, mailer) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const name = clean(input.name, 100), email = clean(input.email, 254).toLowerCase(), body = clean(input.message, 2000);
  if (!isEmail(email)) return fail('Enter your email address so we can reach you if you leave.');
  if (!body) return fail('Write your message.');
  const r = await createTicket(pool, x.org.id, null, { subject: 'Chat: ' + body.replace(/\s+/g, ' ').slice(0, 60), body, requesterEmail: email, requesterName: name, channel: 'chat' });
  if (!r.ok) return r;
  await emit(pool, x.org.id, 'ticket.created', r.ticket.number);
  if (mailer) { try { await notifyTicket(pool, mailer, x.org.id, r.ticket.number, { kind: 'reply', summary: body }); } catch { } }
  return { ok: true, number: r.ticket.number, token: chatToken(env, x.org.id, r.ticket.number), orgId: x.org.id };
}
export async function sendChat(pool, env, slug, input, mailer) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const number = Number(input.number) || 0; if (!tokenOk(env, x.org.id, number, input.token)) return fail('This chat is not yours.', 403);
  const t = await withOrg(pool, x.org.id, async c => (await c.query('select id, channel, requester_name, requester_email from tickets where org_id = $1 and number = $2', [x.org.id, number])).rows[0]);
  if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
  const r = await addRequesterMessage(pool, x.org.id, number, { body: clean(input.message, 2000), authorName: t.requester_name || t.requester_email });
  if (!r.ok) return r.closed ? { ok: false, status: 409, error: 'This chat has ended. Start a new one.' } : r;
  await emit(pool, x.org.id, 'message.customer', number, { message: { body: clean(input.message, 2000).slice(0, 2000) } });
  if (mailer) { try { await notifyTicket(pool, mailer, x.org.id, number, { kind: 'reply', summary: clean(input.message, 300) }); } catch { } }
  return { ok: true, id: r.messageRowId };
}
// the messages after `after` (a message id), both sides; opening the poll marks the visitor as present, which stops reply emails
export async function pollChat(pool, env, slug, number, token, after) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  number = Number(number) || 0; if (!tokenOk(env, x.org.id, number, token)) return fail('This chat is not yours.', 403);
  return withOrg(pool, x.org.id, async c => {
    const t = (await c.query('select id, status, channel from tickets where org_id = $1 and number = $2', [x.org.id, number])).rows[0]; if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
    await c.query('update tickets set chat_seen_at = now() where id = $1', [t.id]);
    const rows = (await c.query("select id, kind, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = $2 and kind in ('requester','agent') and id > $3 order by id limit 100", [x.org.id, t.id, Number(after) || 0])).rows;
    return { ok: true, ended: t.status === 'closed' || t.status === 'solved', messages: rows.map(m => ({ id: Number(m.id), from: m.kind === 'agent' ? 'agent' : 'you', name: m.kind === 'agent' ? m.author_name : '', body: m.body, at: m.created_at })) };
  });
}
// is the visitor's chat window open right now? (then an agent's reply is not emailed as well)
export async function chatOpen(pool, orgId, number) {
  return withOrg(pool, orgId, async c => !!(await c.query("select 1 from tickets where org_id = $1 and number = $2 and channel = 'chat' and chat_seen_at > now() - interval '45 seconds'", [orgId, Number(number) || 0])).rowCount);
}

// ---- the public endpoints: /api/chat/config, /start, /send, /poll (same origin as the chat page, so no cross-site access is given) ----
const hits = new Map();
const tooMany = (key, now, max) => { const w = (hits.get(key) || []).filter(t => now - t < 60000); w.push(now); hits.set(key, w); if (hits.size > 5000) hits.clear(); return w.length > max; };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
export async function chatApi(req, { pool, mailer, env = process.env, now = Date.now() }) {
  const u = new URL(req.url), act = u.pathname.replace(/^\/api\/chat\/?/, '').split('/')[0], ip = String(req.headers.get('x-forwarded-for') || 'x').split(',')[0].trim();
  const slug = u.searchParams.get('org') || '';
  try {
    if (act === 'config' && req.method === 'GET') return json(200, await publicConfig(pool, slug));
    if (act === 'poll' && req.method === 'GET') { if (tooMany('p' + ip, now, 90)) return json(429, { error: 'Slow down.' }); const r = await pollChat(pool, env, slug, u.searchParams.get('n'), u.searchParams.get('t'), u.searchParams.get('after')); return json(r.ok ? 200 : r.status, r); }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const o = req.headers.get('origin'); if (o && new URL(o).host !== u.host) return json(403, { error: 'Bad origin.' });
    const text = await req.text(); if (text.length > 10000) return json(413, { error: 'Too long.' });
    let b; try { b = JSON.parse(text || '{}'); } catch { return json(400, { error: 'Bad request.' }); }
    if (act === 'start') { if (tooMany('s' + ip, now, 6)) return json(429, { error: 'Too many chats started. Wait a minute.' }); const r = await startChat(pool, env, slug, b, mailer); if (r.ok) delete r.orgId; return json(r.ok ? 200 : r.status, r); }
    if (act === 'send') { if (tooMany('m' + ip, now, 30)) return json(429, { error: 'Slow down.' }); const r = await sendChat(pool, env, slug, b, mailer); return json(r.ok ? 200 : r.status, r); }
    return json(404, { error: 'Not found.' });
  } catch { return json(500, { error: 'Something went wrong.' }); }
}
