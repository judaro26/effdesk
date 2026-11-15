// src/chat.js: LIVE CHAT. A visitor on the customer's website opens the chat widget, gives a name and email and a first message, and a ticket with the channel "chat" is created. The visitor's page polls for the agents' replies. The agents answer from the desk as with any ticket; while the visitor's chat window is open the reply appears there, and when it is closed the reply is emailed as usual.
//   a visitor proves it is theirs chat with a token only they were given (a signature of the ticket number); nothing else is public.
import { clientIp, rateLimit } from './guard.js';
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
export const DEFAULTS = { enabled: false, title: 'Chat with us', greeting: 'Hi! Ask us anything. We reply here, and by email if you leave.', color: '#1f73b7', logo_url: null, max_concurrent: 3, auto_resolve_hours: 24, reuse_days: 7 };

export async function getSettings(pool, orgId) {
  return withOrg(pool, orgId, async c => { const r = (await c.query('select enabled, title, greeting, color, logo_url, max_concurrent, auto_resolve_hours, reuse_days from chat_settings where org_id = $1', [orgId])).rows[0]; return { ...DEFAULTS, ...(r || {}) }; });
}
export async function saveSettings(pool, orgId, input) {
  const color = /^#[0-9a-fA-F]{6}$/.test(String(input.color || '')) ? input.color : DEFAULTS.color, title = clean(input.title, 60) || DEFAULTS.title, greeting = clean(input.greeting, 300) || DEFAULTS.greeting, enabled = input.enabled === true;
  const logoUrl = clean(input.logoUrl, 500);
  if (logoUrl) { try { const u = new URL(logoUrl); if (u.protocol !== 'https:' || u.username || u.password) return fail('Logo URL must be a secure HTTPS image address.'); } catch { return fail('Enter a valid HTTPS logo URL, or leave it blank to use the EffDesk logo.'); } }
  const maxConcurrent = input.maxConcurrent === undefined ? DEFAULTS.max_concurrent : Number(input.maxConcurrent);
  const autoResolveHours = input.autoResolveHours === undefined ? DEFAULTS.auto_resolve_hours : Number(input.autoResolveHours);
  const reuseDays = input.reuseDays === undefined ? DEFAULTS.reuse_days : Number(input.reuseDays);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) return fail('Maximum simultaneous chats must be a whole number from 1 to 10.');
  if (!Number.isInteger(autoResolveHours) || autoResolveHours < 0 || autoResolveHours > 720) return fail('Automatic chat resolution must be 0 (off) or between 1 and 720 hours.');
  if (!Number.isInteger(reuseDays) || reuseDays < 0 || reuseDays > 30) return fail('Conversation reuse must be 0 (off) or between 1 and 30 days.');
  await withOrg(pool, orgId, c => c.query('insert into chat_settings (org_id, enabled, title, greeting, color, logo_url, max_concurrent, auto_resolve_hours, reuse_days) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (org_id) do update set enabled = $2, title = $3, greeting = $4, color = $5, logo_url = $6, max_concurrent = $7, auto_resolve_hours = $8, reuse_days = $9, updated_at = now()', [orgId, enabled, title, greeting, color, logoUrl || null, maxConcurrent, autoResolveHours, reuseDays]));
  return { ok: true, settings: { enabled, title, greeting, color, logo_url: logoUrl || null, max_concurrent: maxConcurrent, auto_resolve_hours: autoResolveHours, reuse_days: reuseDays } };
}
async function orgOf(pool, slug) { return (await pool.query('select id, name, slug from "organization" where slug = $1', [String(slug || '').toLowerCase().slice(0, 60)])).rows[0] || null; }
// the widget may run only where the plan includes live chat and the agents turned it on
async function liveOrg(pool, slug) {
  const org = await orgOf(pool, slug); if (!org) return null;
  if (!planHas(await getEntitlements(pool, org.id), 'live_chat')) return null;
  const s = await getSettings(pool, org.id); return s.enabled ? { org, settings: s } : null;
}
export async function publicConfig(pool, slug) {
  const x = await liveOrg(pool, slug);
  if (!x) return { ok: true, enabled: false };
  // Report accepting only when at least one explicitly enabled agent has room for another chat.
  // The visitor can still leave a message when everyone is away or at capacity.
  const online = await withOrg(pool, x.org.id, async c => {
    const r = await c.query(`select exists (
      select 1 from agent_status a
      join member m on m."userId" = a.user_id and m."organizationId" = a.org_id
      where a.org_id = $1 and a.chat_access = true and a.chat_available = true
        and m.role in ('owner','admin','member')
        and (select count(*) from tickets t where t.org_id = a.org_id and t.channel = 'chat'
          and t.assignee_id = a.user_id and t.status in ('open','pending','on_hold')) < $2
    ) as accepting`, [x.org.id, x.settings.max_concurrent || DEFAULTS.max_concurrent]);
    return r.rows[0]?.accepting === true;
  });
  return { ok: true, enabled: true, accepting: online, name: x.org.name, title: x.settings.title, greeting: x.settings.greeting, color: x.settings.color, logo: x.settings.logo_url || null };
}

export async function startChat(pool, env, slug, input, mailer) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const name = clean(input.name, 100), email = clean(input.email, 254).toLowerCase(), body = clean(input.message, 2000);
  if (!isEmail(email)) return fail('Enter your email address so we can reach you if you leave.');
  if (!body) return fail('Write your message.');
  const visitorId = clean(input.visitorId, 64), visitorKey = /^[a-f0-9]{64}$/i.test(visitorId) ? crypto.createHash('sha256').update(x.org.id + ':' + visitorId.toLowerCase()).digest('hex') : null;
  const reuseDays = Number(x.settings.reuse_days ?? DEFAULTS.reuse_days);
  const result = await withOrg(pool, x.org.id, async c => {
    // Serialize starts from the same browser so two tabs cannot create duplicate conversations.
    if (visitorKey) await c.query('select pg_advisory_xact_lock(hashtext($1), hashtext($2))', [x.org.id, visitorKey]);
    let existing = null;
    if (visitorKey && reuseDays > 0) {
      const lifecycle = (await c.query('select config from ticket_lifecycle_policies where org_id=$1', [x.org.id])).rows[0]?.config || {};
      const permanentDays = Number(lifecycle.permanentCloseDays) || 30;
      existing = (await c.query(`select id, number, status from tickets
        where org_id=$1 and channel='chat' and chat_visitor_key=$2 and lower(requester_email)=lower($3)
          and updated_at >= now() - ($4::int * interval '1 day')
          and (status <> 'closed' or $5::boolean = false or closed_at is null or closed_at > now() - ($6::int * interval '1 day'))
        order by updated_at desc, id desc limit 1 for update`, [x.org.id, visitorKey, email, reuseDays, lifecycle.permanentCloseEnabled === true, permanentDays])).rows[0] || null;
    }
    if (existing) {
      const mid = (await c.query("insert into ticket_messages (org_id,ticket_id,kind,author_name,body) values ($1,$2,'requester',$3,$4) returning id", [x.org.id, existing.id, name || email, body])).rows[0].id;
      await c.query("update tickets set status='open', solved_at=null, closed_at=null, updated_at=now() where org_id=$1 and id=$2", [x.org.id, existing.id]);
      await c.query('insert into ticket_events (org_id,ticket_id,actor_name,kind,detail) values ($1,$2,$3,$4,$5)', [x.org.id, existing.id, name || email, 'reopened', 'Visitor returned and continued this Live Chat conversation']);
      return { ok: true, number: existing.number, reused: true };
    }
    const created = await createTicket(pool, x.org.id, null, { subject: 'Chat: ' + body.replace(/\s+/g, ' ').slice(0, 60), body, requesterEmail: email, requesterName: name, channel: 'chat' }, c);
    if (!created.ok) return created;
    if (visitorKey) await c.query('update tickets set chat_visitor_key=$3 where org_id=$1 and id=$2', [x.org.id, created.ticket.id, visitorKey]);
    return { ok: true, number: created.ticket.number, reused: false };
  });
  if (!result.ok) return result;
  await emit(pool, x.org.id, result.reused ? 'message.customer' : 'ticket.created', result.number, result.reused ? { message: { body } } : {});
  if (mailer) { try { await notifyTicket(pool, mailer, x.org.id, result.number, { kind: 'reply', summary: body }); } catch { } }
  return { ok: true, number: result.number, token: chatToken(env, x.org.id, result.number), reused: result.reused === true, orgId: x.org.id };
}
export async function sendChat(pool, env, slug, input, mailer) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const number = Number(input.number) || 0; if (!tokenOk(env, x.org.id, number, input.token)) return fail('This chat is not yours.', 403);
  const t = await withOrg(pool, x.org.id, async c => (await c.query('select id, channel, status, requester_name, requester_email from tickets where org_id = $1 and number = $2', [x.org.id, number])).rows[0]);
  if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
  if (t.status === 'closed' || t.status === 'solved') return fail('This chat has ended. Start a new one.', 409);
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
    const t = (await c.query('select id, status, channel, assignee_id from tickets where org_id = $1 and number = $2', [x.org.id, number])).rows[0]; if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
    await c.query('update tickets set chat_seen_at = now() where id = $1', [t.id]);
    const rows = (await c.query("select id, kind, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = $2 and kind in ('requester','agent') and id > $3 order by id limit 100", [x.org.id, t.id, Number(after) || 0])).rows;
    const agentTyping = !!(t.assignee_id && (await c.query("select 1 from ticket_presence where org_id=$1 and ticket_id=$2 and user_id=$3 and typing=true and seen_at > now() - interval '12 seconds' limit 1", [x.org.id, t.id, t.assignee_id])).rowCount);
    return { ok: true, ended: t.status === 'closed' || t.status === 'solved', agentTyping, messages: rows.map(m => ({ id: Number(m.id), from: m.kind === 'agent' ? 'agent' : 'you', name: m.kind === 'agent' ? m.author_name : '', body: m.body, at: m.created_at })) };
  });
}
// is the visitor's chat window open right now? (then an agent's reply is not emailed as well)
export async function chatOpen(pool, orgId, number) {
  return withOrg(pool, orgId, async c => !!(await c.query("select 1 from tickets where org_id = $1 and number = $2 and channel = 'chat' and chat_seen_at > now() - interval '45 seconds'", [orgId, Number(number) || 0])).rowCount);
}

// Resolve inactive chats hourly. A visitor whose chat window is still polling is
// considered present; fresh ticket activity also protects conversations being handled.
export async function runChatLifecycle(pool, nowMs = Date.now()) {
  let actions = 0, errors = 0;
  const now = new Date(nowMs).toISOString();
  const orgs = (await pool.query('select id from "organization"')).rows;
  for (const { id: orgId } of orgs) {
    try {
      const settings = await getSettings(pool, orgId);
      const hours = Number(settings.auto_resolve_hours ?? DEFAULTS.auto_resolve_hours);
      if (!hours) continue;
      const count = await withOrg(pool, orgId, async c => {
        const stale = await c.query(`update tickets
          set status='solved', solved_at=coalesce(solved_at,$2::timestamptz), updated_at=$2::timestamptz
          where org_id=$1 and channel='chat' and status in ('open','pending','on_hold')
            and updated_at <= $2::timestamptz - ($3::int * interval '1 hour')
            and (chat_seen_at is null or chat_seen_at <= $2::timestamptz - interval '45 seconds')
          returning id, number`, [orgId, now, hours]);
        for (const t of stale.rows) {
          await c.query('insert into ticket_events (org_id,ticket_id,actor_name,kind,detail) values ($1,$2,$3,$4,$5)', [orgId, t.id, 'Live Chat automation', 'status', 'Automatically resolved after ' + hours + ' hours without activity']);
        }
        return stale.rowCount;
      });
      actions += count;
    } catch (e) {
      errors++;
      console.warn('Live Chat lifecycle failed', orgId, e.message);
    }
  }
  return { actions, errors };
}

// ---- the public endpoints: /api/chat/config, /start, /send, /poll (same origin as the chat page, so no cross-site access is given) ----
const hits = new Map();
const tooMany = (pool, key, now, max) => rateLimit(pool, 'chat:' + key, max, 60, now);
const json = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders } });
export async function chatApi(req, { pool, mailer, env = process.env, now = Date.now() }) {
  const u = new URL(req.url), act = u.pathname.replace(/^\/api\/chat\/?/, '').split('/')[0], ip = clientIp(req, env);
  const slug = u.searchParams.get('org') || '';
  try {
    // This endpoint exposes only public widget presentation/availability settings. The embed script calls it from the customer's site, so it must be readable cross-origin.
    if (act === 'config' && req.method === 'GET') return json(200, await publicConfig(pool, slug), { 'Access-Control-Allow-Origin': '*' });
    if (act === 'poll' && req.method === 'GET') { if (await tooMany(pool, 'p' + ip, now, 90)) return json(429, { error: 'Slow down.' }); const r = await pollChat(pool, env, slug, u.searchParams.get('n'), u.searchParams.get('t'), u.searchParams.get('after')); return json(r.ok ? 200 : r.status, r); }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const o = req.headers.get('origin'); if (o && new URL(o).host !== u.host) return json(403, { error: 'Bad origin.' });
    const text = await req.text(); if (text.length > 10000) return json(413, { error: 'Too long.' });
    let b; try { b = JSON.parse(text || '{}'); } catch { return json(400, { error: 'Bad request.' }); }
    if (act === 'start') { if (await tooMany(pool, 's' + ip, now, 6)) return json(429, { error: 'Too many chats started. Wait a minute.' }); const r = await startChat(pool, env, slug, b, mailer); if (r.ok) delete r.orgId; return json(r.ok ? 200 : r.status, r); }
    if (act === 'send') { if (await tooMany(pool, 'm' + ip, now, 30)) return json(429, { error: 'Slow down.' }); const r = await sendChat(pool, env, slug, b, mailer); return json(r.ok ? 200 : r.status, r); }
    return json(404, { error: 'Not found.' });
  } catch { return json(500, { error: 'Something went wrong.' }); }
}
