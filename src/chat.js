// src/chat.js: LIVE CHAT. A visitor on the customer's website opens the chat widget, gives a name and email and a first message, and a ticket with the channel "chat" is created. The visitor's page polls for the agents' replies. The agents answer from the desk as with any ticket; while the visitor's chat window is open the reply appears there, and when it is closed the reply is emailed as usual.
//   a visitor proves it is theirs chat with a token only they were given (a signature of the ticket number); nothing else is public.
import { clientIp, rateLimit } from './guard.js';
import crypto from 'crypto';
import { withOrg } from './db.js';
import { createTicket, addRequesterMessage, writeTicketProvenance, logEvent } from './tickets.js';
import { getEntitlements } from './billing.js';
import { has as planHas } from './plans.js';
import { emit } from './webhooks.js';
import { notifyTicket } from './notify.js';
import { warn as logWarn, error as logError } from './log.js';

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
  let logoUrl = clean(input.logoUrl, 500);
  const logoAssetId = clean(input.logoAssetId, 64);
  if (logoAssetId) {
    if (!/^[a-f0-9-]{36}$/i.test(logoAssetId)) return fail('Choose a valid uploaded logo.');
    const asset = await withOrg(pool, orgId, async c => (await c.query("select id from help_images where org_id=$1 and id=$2 and content_type in ('image/png','image/jpeg','image/gif','image/webp')", [orgId, logoAssetId])).rows[0]);
    if (!asset) return fail('That uploaded logo is no longer available. Upload it again.', 404);
    const slug = (await pool.query('select slug from "organization" where id=$1', [orgId])).rows[0]?.slug;
    if (!slug) return fail('Workspace not found.', 404);
    logoUrl = '/help/' + slug + '/img/' + logoAssetId;
  } else if (logoUrl) {
    try { const u = new URL(logoUrl); if (u.protocol !== 'https:' || u.username || u.password) return fail('Logo URL must be a secure HTTPS image address.'); }
    catch { return fail('Enter a valid HTTPS logo address, or upload a logo image.'); }
  }
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
        and m.role in ('owner','admin','member') and a.chat_last_seen_at > now() - interval '3 minutes'
        and (select count(*) from tickets t where t.org_id = a.org_id and t.channel = 'chat'
          and t.assignee_id = a.user_id and t.status in ('open','pending','on_hold')) < $2
    ) as accepting`, [x.org.id, x.settings.max_concurrent || DEFAULTS.max_concurrent]);
    return r.rows[0]?.accepting === true;
  });
  return { ok: true, enabled: true, accepting: online, name: x.org.name, title: x.settings.title, greeting: x.settings.greeting, color: x.settings.color, logo: x.settings.logo_url || null };
}

// Server-paged Live Chat inbox. Counts describe the full filtered set, not only the visible page.
export async function agentInbox(pool, orgId, input = {}) {
  const limit = Math.min(Math.max(parseInt(input.limit, 10) || 50, 1), 100);
  const cursorMode = input.cursorMode === true || typeof input.cursor === 'string';
  const query = clean(input.q, 100);
  const view = ['all', 'waiting', 'needs-reply', 'mine', 'history'].includes(input.view) ? input.view : 'all';
  const history = view === 'history';
  const args = [orgId], where = ['t.org_id = $1', "t.channel = 'chat'", history ? "t.status in ('solved','closed')" : "t.status in ('open','pending','on_hold')"];
  if (view === 'waiting') where.push('t.assignee_id is null');
  if (view === 'needs-reply') where.push("t.assignee_id is not null and latest_public.kind = 'requester'");
  if (view === 'mine') { args.push(String(input.agentId || '')); where.push('t.assignee_id = $' + args.length); }
  if (query) {
    const like = query.toLowerCase().replace(/[\\%_]/g, m => '\\' + m) + '%';
    args.push(like); const i = args.length;
    const number = /^#?\d{1,9}$/.test(query) ? Number(query.replace('#', '')) : null;
    args.push(number);
    where.push('(lower(t.subject) like $' + i + ' or lower(t.requester_name) like $' + i + ' or lower(t.requester_email) like $' + i + ' or lower(assignee.name) like $' + i + ' or lower(assignee.email) like $' + i + ' or ($' + (i + 1) + '::int is not null and t.number = $' + (i + 1) + '::int))');
  }
  let cursor = null, cursorWhere = '';
  if (cursorMode && input.cursor) {
    try {
      cursor = JSON.parse(Buffer.from(String(input.cursor), 'base64url').toString('utf8'));
      if (cursor.v !== 1 || cursor.h !== history || !Number.isSafeInteger(Number(cursor.id)) || Number(cursor.id) < 1 || !Number.isFinite(new Date(cursor.u).getTime())) throw new Error('invalid');
      if (history) {
        if (!Number.isFinite(new Date(cursor.s).getTime())) throw new Error('invalid');
        args.push(new Date(cursor.s).toISOString(), new Date(cursor.u).toISOString(), Number(cursor.id));
        const s = args.length - 2, u = args.length - 1, id = args.length;
        cursorWhere = 'where (cursor_history_at < $' + s + '::timestamptz or (cursor_history_at = $' + s + '::timestamptz and (updated_at < $' + u + '::timestamptz or (updated_at = $' + u + '::timestamptz and id < $' + id + '::bigint))))';
      } else {
        if (![0,1].includes(Number(cursor.b)) || ![0,1].includes(Number(cursor.n)) || (cursor.w !== null && !Number.isFinite(new Date(cursor.w).getTime()))) throw new Error('invalid');
        args.push(Number(cursor.b), cursor.w === null ? null : new Date(cursor.w).toISOString(), Number(cursor.n), new Date(cursor.u).toISOString(), Number(cursor.id));
        const b=args.length-4,w=args.length-3,n=args.length-2,u=args.length-1,id=args.length;
        cursorWhere = 'where (cursor_bucket > $' + b + ' or (cursor_bucket = $' + b + ' and coalesce(cursor_waiting_at, \'infinity\'::timestamptz) > coalesce($' + w + '::timestamptz, \'infinity\'::timestamptz)) or (cursor_bucket = $' + b + ' and coalesce(cursor_waiting_at, \'infinity\'::timestamptz) = coalesce($' + w + '::timestamptz, \'infinity\'::timestamptz) and cursor_needs_reply > $' + n + ') or (cursor_bucket = $' + b + ' and coalesce(cursor_waiting_at, \'infinity\'::timestamptz) = coalesce($' + w + '::timestamptz, \'infinity\'::timestamptz) and cursor_needs_reply = $' + n + ' and (updated_at < $' + u + '::timestamptz or (updated_at = $' + u + '::timestamptz and id < $' + id + '::bigint))))';
      }
    } catch { return fail('The Live Chat inbox cursor is invalid. Refresh the inbox and try again.'); }
  }
  return withOrg(pool, orgId, async db => {
    const limitArg = args.length + 1; args.push(cursorMode ? limit + 1 : limit);
    let offsetSql = '';
    if (!cursorMode) { args.push(Math.min(Math.max(parseInt(input.offset, 10) || 0, 0), 1000000)); offsetSql = ' offset $' + args.length; }
    const order = history ? 'cursor_history_at desc, updated_at desc, id desc' : 'cursor_bucket asc, cursor_waiting_at asc nulls last, cursor_needs_reply asc, updated_at desc, id desc';
    const sql = [
      'with chat_rows as (',
      ' select t.id, t.number, t.subject, t.status, t.assignee_id, t.requester_name, t.requester_email, t.created_at, t.updated_at, t.solved_at, t.closed_at, latest_public.kind as chat_last_public_message_kind, assignee.name as assignee_name, assignee.email as assignee_email, case when t.assignee_id is null then 0 else 1 end as cursor_bucket, case when t.assignee_id is null then t.created_at end as cursor_waiting_at, case when t.assignee_id is not null and latest_public.kind = \'requester\' then 0 else 1 end as cursor_needs_reply, coalesce(t.closed_at,t.solved_at,t.updated_at) as cursor_history_at',
      ' from tickets t left join lateral (select tm.kind from ticket_messages tm where tm.org_id=t.org_id and tm.ticket_id=t.id and tm.kind in (\'requester\',\'agent\') order by tm.created_at desc, tm.id desc limit 1) latest_public on true left join "user" assignee on assignee.id=t.assignee_id',
      ' where ' + where.join(' and '),
      '), totals as (select count(*)::int total, count(*) filter(where assignee_id is null)::int waiting, count(*) filter(where assignee_id is not null)::int assigned, count(*) filter(where assignee_id is not null and chat_last_public_message_kind=\'requester\')::int needs_reply, count(*) filter(where status=\'solved\')::int solved, count(*) filter(where status=\'closed\')::int closed from chat_rows),',
      'page as (select * from chat_rows ' + cursorWhere + ' order by ' + order + ' limit $' + limitArg + offsetSql + ')',
      'select page.*, totals.total as total_count, totals.waiting as waiting_count, totals.assigned as assigned_count, totals.needs_reply as needs_reply_count, totals.solved as solved_count, totals.closed as closed_count from totals left join page on true'
    ].join(' ');
    const result = await db.query(sql, args), first = result.rows[0] || {};
    const agentId = String(input.agentId || '');
    const maxConcurrent = Math.max(1, Math.min(10, Number((await db.query('select max_concurrent from chat_settings where org_id=$1',[orgId])).rows[0]?.max_concurrent) || 3));
    const activeChats = agentId ? Number((await db.query("select count(*)::int n from tickets where org_id=$1 and channel='chat' and assignee_id=$2 and status in ('open','pending','on_hold')",[orgId,agentId])).rows[0]?.n || 0) : 0;
    let rows = result.rows.filter(row => row.id != null);
    const hasMore = cursorMode && rows.length > limit;
    if (hasMore) rows.pop();
    const last = rows[rows.length - 1];
    const nextCursor = cursorMode && hasMore && last ? Buffer.from(JSON.stringify(history ? { v:1, h:true, s:last.cursor_history_at, u:last.updated_at, id:Number(last.id) } : { v:1, h:false, b:Number(last.cursor_bucket), w:last.cursor_waiting_at ? new Date(last.cursor_waiting_at).toISOString() : null, n:Number(last.cursor_needs_reply), u:last.updated_at, id:Number(last.id) })).toString('base64url') : null;
    return {
      ok: true,
      tickets: rows.map(({ total_count, waiting_count, assigned_count, needs_reply_count, solved_count, closed_count, cursor_bucket, cursor_waiting_at, cursor_needs_reply, cursor_history_at, ...ticket }) => ticket),
      counts: { total: Number(first.total_count || 0), waiting: Number(first.waiting_count || 0), assigned: Number(first.assigned_count || 0), needsReply: Number(first.needs_reply_count || 0), solved: Number(first.solved_count || 0), closed: Number(first.closed_count || 0) },
      capacity: { active: activeChats, max: maxConcurrent, remaining: Math.max(0,maxConcurrent-activeChats) },
      page: { limit, offset: cursorMode ? (Number(input.pageIndex) || 0) * limit : Math.min(Math.max(parseInt(input.offset, 10) || 0, 0), 1000000), hasMore: cursorMode ? hasMore : Math.min(Math.max(parseInt(input.offset, 10) || 0, 0), 1000000) + limit < Number(first.total_count || 0), ...(cursorMode ? { nextCursor } : {}) }
    };
  });
}
// Lightweight cursor-based notification feed so each agent does not repeatedly download the full chat queue.
export async function agentReplyAlerts(pool, orgId, input = {}) {
  return withOrg(pool, orgId, async db => {
    if (input.initialize === true) {
      const row = (await db.query("select coalesce(max(tm.id),0)::text as cursor from ticket_messages tm join tickets t on t.org_id=tm.org_id and t.id=tm.ticket_id where tm.org_id=$1 and tm.kind='requester' and t.channel='chat'", [orgId])).rows[0];
      return { ok: true, cursor: String(row?.cursor || '0'), replies: [], hasMore: false };
    }
    const after = /^\d{1,18}$/.test(String(input.after || '')) ? String(input.after) : '0';
    const rows = (await db.query("select tm.id,t.number,t.requester_name,t.requester_email,t.updated_at,t.status from ticket_messages tm join tickets t on t.org_id=tm.org_id and t.id=tm.ticket_id where tm.org_id=$1 and tm.id>$2::bigint and tm.kind='requester' and t.channel='chat' order by tm.id asc limit 101", [orgId, after])).rows;
    const hasMore = rows.length > 100, page = rows.slice(0, 100), cursor = page.length ? String(page[page.length - 1].id) : after;
    return { ok: true, cursor, hasMore, replies: page.filter(t => ['open','pending','on_hold'].includes(t.status)).map(t => ({ number: Number(t.number), requester_name: t.requester_name, requester_email: t.requester_email, updated_at: t.updated_at })) };
  });
}
export async function startChat(pool, env, slug, input, mailer, provenance = {}) {
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
      await writeTicketProvenance(c,x.org.id,existing.id,{...provenance,identityType:'visitor'});
      await c.query('insert into ticket_events (org_id,ticket_id,actor_name,kind,detail) values ($1,$2,$3,$4,$5)', [x.org.id, existing.id, name || email, 'reopened', 'Visitor returned and continued this Live Chat conversation']);
      return { ok: true, number: existing.number, reused: true };
    }
    const created = await createTicket(pool, x.org.id, null, { subject: 'Chat: ' + body.replace(/\s+/g, ' ').slice(0, 60), body, requesterEmail: email, requesterName: name, channel: 'chat', provenance:{...provenance,identityType:'visitor'} }, c);
    if (!created.ok) return created;
    if (visitorKey) await c.query('update tickets set chat_visitor_key=$3 where org_id=$1 and id=$2', [x.org.id, created.ticket.id, visitorKey]);
    return { ok: true, number: created.ticket.number, reused: false };
  });
  if (!result.ok) return result;
  await emit(pool, x.org.id, result.reused ? 'message.customer' : 'ticket.created', result.number, result.reused ? { message: { body } } : {});
  if (mailer) { try { await notifyTicket(pool, mailer, x.org.id, result.number, { kind: 'reply', summary: body }); } catch (e) { logWarn('live_chat.notification_failed', { error: e, org: x.org.id, ticket: result.number, operation: 'start' }); } }
  return { ok: true, number: result.number, token: chatToken(env, x.org.id, result.number), reused: result.reused === true, orgId: x.org.id };
}
// Convert a chat into a regular ticket while keeping the source conversation and preserving every transcript entry.
export async function convertChatToTicket(pool,orgId,actor,number){return withOrg(pool,orgId,async c=>{const src=(await c.query("select id,number,subject,requester_name,requester_email,priority,tags,converted_ticket_id from tickets where org_id=$1 and number=$2 and channel='chat' for update",[orgId,Number(number)||0])).rows[0];if(!src)return fail('Live Chat conversation not found.',404);if(src.converted_ticket_id){const old=(await c.query('select number,subject from tickets where org_id=$1 and id=$2',[orgId,src.converted_ticket_id])).rows[0];return old?{ok:true,number:old.number,subject:old.subject,alreadyConverted:true}:fail('The linked ticket could not be found.',409);}const msgs=(await c.query("select kind,author_id,author_name,body,html_body,created_at from ticket_messages where org_id=$1 and ticket_id=$2 and kind in ('requester','agent','note') order by created_at,id limit 10000",[orgId,src.id])).rows;if(!msgs.length)return fail('This conversation has no transcript to copy.');const p=(await c.query('select ip_address,identity_type,page_url,page_title,referrer,user_agent from ticket_provenance where org_id=$1 and ticket_id=$2',[orgId,src.id])).rows[0]||{};const made=await createTicket(pool,orgId,actor,{subject:('Follow-up: '+String(src.subject||'Live Chat').replace(/^\\s*chat\\s*:\\s*/i,'')).slice(0,200),body:'Transcript imported from Live Chat conversation #'+src.number+'.',requesterName:src.requester_name,requesterEmail:src.requester_email,priority:src.priority,tags:src.tags,channel:'web',firstKind:'note',sourceChatTicketId:src.id,provenance:{ip:p.ip_address,identityType:p.identity_type,pageUrl:p.page_url,pageTitle:p.page_title,referrer:p.referrer,userAgent:p.user_agent}},c);if(!made.ok)return made;await c.query('delete from ticket_messages where org_id=$1 and id=$2',[orgId,made.messageRowId]);for(const m of msgs)await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body,html_body,created_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[orgId,made.ticket.id,m.kind,m.author_id,m.author_name,m.body,m.html_body,m.created_at]);await c.query('update tickets set converted_ticket_id=$3 where org_id=$1 and id=$2',[orgId,src.id,made.ticket.id]);await logEvent(c,orgId,src.id,actor?.name||actor?.email||'Agent','converted','Converted to support ticket #'+made.ticket.number);await logEvent(c,orgId,made.ticket.id,actor?.name||actor?.email||'Agent','created','Created from Live Chat conversation #'+src.number+'; transcript preserved');return{ok:true,number:made.ticket.number,subject:made.ticket.subject,alreadyConverted:false};});}

export async function endChat(pool, env, slug, input) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const number = Number(input.number) || 0; if (!tokenOk(env, x.org.id, number, input.token)) return fail('This chat is not yours.', 403);
  return withOrg(pool, x.org.id, async db => {
    const t = (await db.query("select id,status,channel from tickets where org_id=$1 and number=$2 for update", [x.org.id, number])).rows[0];
    if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
    if (['closed','solved'].includes(t.status)) return { ok: true, ended: true, alreadyEnded: true };
    await db.query("update tickets set status='closed',closed_at=coalesce(closed_at,now()),updated_at=now() where org_id=$1 and id=$2", [x.org.id, t.id]);
    await logEvent(db, x.org.id, t.id, 'Website visitor', 'status', 'Visitor ended the Live Chat conversation');
    return { ok: true, ended: true };
  });
}
const transcriptEscape = value => String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export async function requestChatTranscript(pool, env, slug, input, mailer) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const number = Number(input.number) || 0; if (!tokenOk(env, x.org.id, number, input.token)) return fail('This chat is not yours.', 403);
  if (!mailer || typeof mailer.ticketMail !== 'function') return fail('Transcript email is temporarily unavailable. Please try again later.', 503);
  const data = await withOrg(pool, x.org.id, async db => {
    const t = (await db.query("select id,subject,requester_name,requester_email,status from tickets where org_id=$1 and number=$2 and channel='chat'", [x.org.id, number])).rows[0];
    if (!t) return null;
    const messages = (await db.query("select kind,author_name,body,created_at from ticket_messages where org_id=$1 and ticket_id=$2 and kind in ('requester','agent') order by created_at asc,id asc limit 501", [x.org.id, t.id])).rows;
    return { ticket:t, messages };
  });
  if (!data) return fail('No such chat.', 404);
  if (!isEmail(String(data.ticket.requester_email || ''))) return fail('There is no valid email address on this conversation. Please contact the support team.', 400);
  const truncated = data.messages.length > 500, messages = data.messages.slice(0,500);
  const lines = messages.map(m => '[' + (m.created_at ? new Date(m.created_at).toISOString() : '') + '] ' + (m.kind === 'agent' ? (m.author_name || 'Support agent') : (data.ticket.requester_name || 'You')) + ':\n' + String(m.body || ''));
  if (truncated) lines.push('[Transcript shortened to the most recent 500 messages.]');
  const html = '<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202a33;line-height:1.5"><h1>Your support conversation</h1><p>' + transcriptEscape(x.org.name) + ' · Conversation #' + number + '</p>' + messages.map(m => '<section style="padding:12px 0;border-bottom:1px solid #e5e9ed"><strong>' + transcriptEscape(m.kind === 'agent' ? (m.author_name || 'Support agent') : (data.ticket.requester_name || 'You')) + '</strong><small style="display:block;color:#66737d">' + transcriptEscape(m.created_at ? new Date(m.created_at).toISOString() : '') + '</small><p style="white-space:pre-wrap">' + transcriptEscape(m.body) + '</p></section>').join('') + (truncated ? '<p>Transcript limited to the most recent 500 messages.</p>' : '') + '<p style="color:#66737d;font-size:12px">Internal notes and private agent-only content are excluded.</p></body></html>';
  await mailer.ticketMail({ to:data.ticket.requester_email, subject:'Your support conversation transcript · #' + number, text:'Your support conversation with ' + x.org.name + ' · #' + number + '\n\n' + lines.join('\n\n') + '\n\nInternal notes are excluded.', html });
  await withOrg(pool, x.org.id, db => logEvent(db, x.org.id, data.ticket.id, 'Website visitor', 'transcript_requested', 'Visitor requested an emailed transcript'));
  return { ok:true, sent:true };
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
  if (mailer) { try { await notifyTicket(pool, mailer, x.org.id, number, { kind: 'reply', summary: clean(input.message, 300) }); } catch (e) { logWarn('live_chat.notification_failed', { error: e, org: x.org.id, ticket: number, operation: 'visitor_reply' }); } }
  return { ok: true, id: r.messageRowId };
}
// The visitor heartbeat is throttled: polls can arrive every few seconds, but presence
// only needs refreshing every 15 seconds to remain safely inside chatOpen's 45-second window.
export async function pollChat(pool, env, slug, number, token, after) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  number = Number(number) || 0; if (!tokenOk(env, x.org.id, number, token)) return fail('This chat is not yours.', 403);
  return withOrg(pool, x.org.id, async c => {
    const t = (await c.query(`select t.id, t.status, t.channel, t.assignee_id,
      u.name as assignee_name, u.email as assignee_email,
      exists (select 1 from ticket_presence p where p.org_id=t.org_id and p.ticket_id=t.id
        and p.user_id=t.assignee_id and p.typing=true and p.seen_at > now() - interval '12 seconds') as agent_typing
      from tickets t left join "user" u on u.id = t.assignee_id
      where t.org_id = $1 and t.number = $2`, [x.org.id, number])).rows[0];
    if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
    // Ended conversations no longer need to advertise visitor presence. For active
    // conversations, avoid a write/WAL/index update on every otherwise-idle poll.
    if (t.status !== 'closed' && t.status !== 'solved') {
      await c.query(`update tickets set chat_seen_at = now()
        where id = $1 and (chat_seen_at is null or chat_seen_at < now() - interval '15 seconds')`, [t.id]);
    }
    const rows = (await c.query("select id, kind, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = $2 and kind in ('requester','agent') and id > $3 order by id limit 100", [x.org.id, t.id, Number(after) || 0])).rows;
    return { ok: true, ended: t.status === 'closed' || t.status === 'solved', assigned: !!t.assignee_id, agentName: t.assignee_name || t.assignee_email || '', agentTyping: t.agent_typing === true, messages: rows.map(m => ({ id: Number(m.id), from: m.kind === 'agent' ? 'agent' : 'you', name: m.kind === 'agent' ? m.author_name : '', body: m.body, at: m.created_at })) };
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
    if (act === 'config' && req.method === 'GET') { const config = await publicConfig(pool, slug); if (config.logo && config.logo.startsWith('/')) config.logo = new URL(config.logo, u.origin).href; return json(200, config, { 'Access-Control-Allow-Origin': '*' }); }
    if (act === 'poll' && req.method === 'GET') { if (await tooMany(pool, 'p' + ip, now, 90)) return json(429, { error: 'Slow down.' }); const r = await pollChat(pool, env, slug, u.searchParams.get('n'), u.searchParams.get('t'), u.searchParams.get('after')); return json(r.ok ? 200 : r.status, r); }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const o = req.headers.get('origin'); if (o && new URL(o).host !== u.host) return json(403, { error: 'Bad origin.' });
    const text = await req.text(); if (text.length > 10000) return json(413, { error: 'Too long.' });
    let b; try { b = JSON.parse(text || '{}'); } catch { return json(400, { error: 'Bad request.' }); }
    if (act === 'start') { if (await tooMany(pool, 's' + ip, now, 6)) return json(429, { error: 'Too many chats started. Wait a minute.' }); const r = await startChat(pool, env, slug, b, mailer, {ip,pageUrl:b.pageUrl,pageTitle:b.pageTitle,referrer:req.headers.get('referer'),userAgent:req.headers.get('user-agent'),identityType:'visitor'}); if (r.ok) delete r.orgId; return json(r.ok ? 200 : r.status, r); }
    if (act === 'send') { if (await tooMany(pool, 'm' + ip, now, 30)) return json(429, { error: 'Slow down.' }); const r = await sendChat(pool, env, slug, b, mailer); return json(r.ok ? 200 : r.status, r); }
    if (act === 'end') { if (await tooMany(pool, 'e' + ip, now, 5)) return json(429, { error: 'Please wait before ending another chat.' }); const r = await endChat(pool, env, slug, b); return json(r.ok ? 200 : r.status, r); }
    if (act === 'transcript') { if (await tooMany(pool, 'tr' + ip, now, 3)) return json(429, { error: 'Please wait before requesting another transcript.' }); const r = await requestChatTranscript(pool, env, slug, b, mailer); return json(r.ok ? 200 : r.status, r); }
    return json(404, { error: 'Not found.' });
  } catch (e) {
    // The request logger forwards this original exception (including stack) to the error registry.
    logError('live_chat.api_exception', { error: e, operation: act, org: slug });
    return json(500, { error: 'Something went wrong.' });
  }
}
