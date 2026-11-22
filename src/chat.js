// src/chat.js: LIVE CHAT. Visitor conversations and messages live independently of support tickets. Agents can explicitly convert a conversation into a ticket, preserving its transcript.
//   a visitor proves ownership with a signed, opaque conversation number; nothing else is public.
import { clientIp, rateLimit } from './guard.js';
import crypto from 'crypto';
import net from 'node:net';
import { withOrg } from './db.js';
import { MAX_UPLOAD, saveChatUpload, readFile, cleanName } from './attachments.js';
import { createTicket } from './tickets.js';
import { getEntitlements } from './billing.js';
import { has as planHas } from './plans.js';
import { emit } from './webhooks.js';
import { autoAssignChat } from './routing.js';
import { enqueueJob } from './jobs.js';
import { DEFAULT_CHAT_HOURS, validateChatHours, chatHoursStatus } from './chat-hours.js';
import { warn as logWarn, error as logError } from './log.js';

const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const safePageUrl = value => { try { const u = new URL(clean(value,2048)); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return null; u.search=''; u.hash=''; return u.href.slice(0,2048); } catch { return null; } };
const safeIp = value => { const ip=clean(value,64).replace(/^\[|\]$/g,'').split('%')[0]; return net.isIP(ip) ? ip : null; };
const fail = (error, status = 400) => ({ ok: false, status, error });
const secret = env => String(env.EMAIL_TOKEN_SECRET || env.BETTER_AUTH_SECRET || '');
export const chatToken = (env, orgId, number) => crypto.createHmac('sha256', secret(env)).update(`chat:${orgId}:${number}`).digest('hex').slice(0, 24);
const tokenOk = (env, orgId, number, tok) => { const a = Buffer.from(chatToken(env, orgId, number)), b = Buffer.from(String(tok || '')); return !!secret(env) && a.length === b.length && crypto.timingSafeEqual(a, b); };
async function conversationForNumber(c,orgId,number,lock=false){
 const sql=`select cc.*,(exists(select 1 from chat_events ended where ended.org_id=cc.org_id and ended.conversation_id=cc.id and ended.kind='visitor_ended')) as visitor_ended,u.name as assignee_name,u.email as assignee_email from chat_conversations cc left join tickets legacy_ticket on legacy_ticket.org_id=cc.org_id and legacy_ticket.id=cc.source_ticket_id left join "user" u on u.id=cc.assignee_id
  where cc.org_id=$1 and (cc.chat_number=$2 or legacy_ticket.number=$2 or cc.id=$2) order by (cc.chat_number=$2) desc,(legacy_ticket.number=$2) desc limit 1${lock?' for update of cc':''}`;
 return (await c.query(sql,[orgId,Number(number)||0])).rows[0]||null;
}
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
export const DEFAULTS = { enabled: false, title: 'Chat with us', greeting: 'Hi! Ask us anything. We reply here, and by email if you leave.', color: '#1f73b7', logo_url: null, max_concurrent: 3, auto_resolve_hours: 24, reuse_days: 7, restart_cooldown_seconds: 15, auto_convert_to_ticket: false, ...DEFAULT_CHAT_HOURS };

export async function getSettings(pool, orgId) {
  return withOrg(pool, orgId, async c => { const r = (await c.query('select enabled, title, greeting, color, logo_url, max_concurrent, auto_resolve_hours, reuse_days, restart_cooldown_seconds, auto_convert_to_ticket, availability_enabled, availability_timezone, weekly_hours, availability_holidays, after_hours_mode, after_hours_message from chat_settings where org_id = $1', [orgId])).rows[0]; return { ...DEFAULTS, ...(r || {}) }; });
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
  const restartCooldownSeconds = input.restartCooldownSeconds === undefined ? DEFAULTS.restart_cooldown_seconds : Number(input.restartCooldownSeconds);
  const autoConvertToTicket = input.autoConvertToTicket === undefined ? (await getSettings(pool, orgId)).auto_convert_to_ticket === true : input.autoConvertToTicket === true;
  const priorSettings = await getSettings(pool, orgId);
  const checkedHours = validateChatHours({ availabilityEnabled: input.availabilityEnabled === undefined ? priorSettings.availability_enabled : input.availabilityEnabled, availabilityTimezone: input.availabilityTimezone === undefined ? priorSettings.availability_timezone : input.availabilityTimezone, weeklyHours: input.weeklyHours === undefined ? priorSettings.weekly_hours : input.weeklyHours, availabilityHolidays: input.availabilityHolidays === undefined ? priorSettings.availability_holidays : input.availabilityHolidays, afterHoursMode: input.afterHoursMode === undefined ? priorSettings.after_hours_mode : input.afterHoursMode, afterHoursMessage: input.afterHoursMessage === undefined ? priorSettings.after_hours_message : input.afterHoursMessage });
  if (!checkedHours.ok) return fail(checkedHours.error);
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) return fail('Maximum simultaneous chats must be a whole number from 1 to 10.');
  if (!Number.isInteger(autoResolveHours) || autoResolveHours < 0 || autoResolveHours > 720) return fail('Automatic chat resolution must be 0 (off) or between 1 and 720 hours.');
  if (!Number.isInteger(reuseDays) || reuseDays < 0 || reuseDays > 30) return fail('Conversation reuse must be 0 (off) or between 1 and 30 days.');
  if (!Number.isInteger(restartCooldownSeconds) || restartCooldownSeconds < 0 || restartCooldownSeconds > 3600) return fail('The visitor restart cooldown must be a whole number from 0 to 3600 seconds.');
  await withOrg(pool, orgId, c => c.query('insert into chat_settings (org_id, enabled, title, greeting, color, logo_url, max_concurrent, auto_resolve_hours, reuse_days, restart_cooldown_seconds, auto_convert_to_ticket, availability_enabled, availability_timezone, weekly_hours, availability_holidays, after_hours_mode, after_hours_message) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17) on conflict (org_id) do update set enabled = $2, title = $3, greeting = $4, color = $5, logo_url = $6, max_concurrent = $7, auto_resolve_hours = $8, reuse_days = $9, restart_cooldown_seconds = $10, auto_convert_to_ticket = $11, availability_enabled = $12, availability_timezone = $13, weekly_hours = $14::jsonb, availability_holidays = $15::jsonb, after_hours_mode = $16, after_hours_message = $17, updated_at = now()', [orgId, enabled, title, greeting, color, logoUrl || null, maxConcurrent, autoResolveHours, reuseDays, restartCooldownSeconds, autoConvertToTicket, checkedHours.settings.availability_enabled, checkedHours.settings.availability_timezone, JSON.stringify(checkedHours.settings.weekly_hours), JSON.stringify(checkedHours.settings.availability_holidays), checkedHours.settings.after_hours_mode, checkedHours.settings.after_hours_message]));
  invalidateLiveOrgCache(orgId);
  return { ok: true, settings: { enabled, title, greeting, color, logo_url: logoUrl || null, max_concurrent: maxConcurrent, auto_resolve_hours: autoResolveHours, reuse_days: reuseDays, restart_cooldown_seconds: restartCooldownSeconds, auto_convert_to_ticket: autoConvertToTicket, ...checkedHours.settings } };
}
async function orgOf(pool, slug) { return (await pool.query('select id, name, slug from "organization" where slug = $1', [String(slug || '').toLowerCase().slice(0, 60)])).rows[0] || null; }
// Public widget configuration changes infrequently. A short per-instance cache avoids
// repeating organization, entitlement, and settings reads on every visitor poll. Settings
// writes invalidate it immediately; entitlement changes converge within five seconds.
const LIVE_ORG_CACHE_MS = 5000;
// Keep entries scoped to their pool instance so tests or multiple runtime pools can
// never reuse another pool's workspace/configuration result.
const liveOrgCache = new Map();
function cacheForPool(pool) {
  let cache = liveOrgCache.get(pool);
  if (!cache) { cache = new Map(); liveOrgCache.set(pool, cache); }
  return cache;
}
function invalidateLiveOrgCache(orgId) {
  for (const cache of liveOrgCache.values()) {
    for (const [key, entry] of cache) if (entry.orgId === orgId) cache.delete(key);
  }
}
// the widget may run only where the plan includes live chat and the agents turned it on
async function liveOrg(pool, slug) {
  const cache = cacheForPool(pool), key = String(slug || '').toLowerCase().slice(0, 60), hit = cache.get(key);
  if (hit && Date.now() - hit.at < LIVE_ORG_CACHE_MS) return hit.value;
  const remember = entry => {
    if (cache.size > 2000) cache.clear();
    cache.set(key, entry);
  };
  const org = await orgOf(pool, key);
  if (!org) { remember({ at: Date.now(), orgId: null, value: null }); return null; }
  if (!planHas(await getEntitlements(pool, org.id), 'live_chat')) {
    remember({ at: Date.now(), orgId: org.id, value: null }); return null;
  }
  const settings = await getSettings(pool, org.id), value = settings.enabled ? { org, settings } : null;
  remember({ at: Date.now(), orgId: org.id, value });
  return value;
}
export async function publicConfig(pool, slug, nowMs = Date.now()) {
  const x = await liveOrg(pool, slug);
  if (!x) return { ok: true, enabled: false };
  const hours = chatHoursStatus(x.settings, nowMs);
  if (x.settings.availability_enabled === true && !hours.open && x.settings.after_hours_mode === 'hide') return { ok: true, enabled: false, scheduleOpen: false };
  // Report accepting only when at least one explicitly enabled agent has room for another chat.
  // The visitor can still leave a message when everyone is away or at capacity.
  const online = await withOrg(pool, x.org.id, async c => {
    const r = await c.query(`select exists (
      select 1 from agent_status a
      join member m on m."userId" = a.user_id and m."organizationId" = a.org_id
      where a.org_id = $1 and a.chat_access = true and a.chat_available = true
        and m.role in ('owner','admin','member') and a.chat_last_seen_at > now() - interval '3 minutes'
        and (select count(*) from chat_conversations t where t.org_id = a.org_id
          and t.assignee_id = a.user_id and t.status in ('open','pending','on_hold')) < $2
    ) as accepting`, [x.org.id, x.settings.max_concurrent || DEFAULTS.max_concurrent]);
    return r.rows[0]?.accepting === true;
  });
  return { ok: true, enabled: true, accepting: online && hours.open, scheduleOpen: hours.open, scheduleEnabled: x.settings.availability_enabled === true, afterHoursMode: x.settings.after_hours_mode || 'contact_form', afterHoursMessage: x.settings.after_hours_message || DEFAULT_CHAT_HOURS.after_hours_message, name: x.org.name, title: x.settings.title, greeting: x.settings.greeting, color: x.settings.color, logo: x.settings.logo_url || null, restartCooldownSeconds: Number(x.settings.restart_cooldown_seconds ?? DEFAULTS.restart_cooldown_seconds) };
}

// Independent, tenant-scoped Live Chat inbox. Conversation ids are stable chat numbers.
export async function agentInbox(pool, orgId, input = {}) {
  const limit=Math.min(Math.max(parseInt(input.limit,10)||40,1),100),view=['all','waiting','needs-reply','mine','history'].includes(input.view)?input.view:'all',q=clean(input.q,100).toLowerCase();
  return withOrg(pool,orgId,async c=>{
    const args=[orgId],where=['cc.org_id=$1'];
    where.push(view==='history'?"cc.status in ('solved','closed')":"(cc.status in ('open','pending','on_hold') or (cc.status='closed' and exists(select 1 from chat_events ended where ended.org_id=cc.org_id and ended.conversation_id=cc.id and ended.kind='visitor_ended')))");
    if(view==='waiting')where.push("cc.assignee_id is null and cc.status <> 'closed'");
    if(view==='mine'){args.push(String(input.agentId||''));where.push('cc.assignee_id=$'+args.length);}
    if(q){args.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');where.push('(lower(cc.requester_name) like $'+args.length+' or lower(cc.requester_email) like $'+args.length+' or lower(cc.subject) like $'+args.length+')');}
    if(view==='needs-reply')where.push("cc.status <> 'closed' and latest_message.kind='requester'");
    const offset=Math.max(0,Math.min(parseInt(input.offset,10)||0,1000000));
    const rows=(await c.query(`select cc.chat_number as number,cc.id,cc.subject,cc.status,cc.assignee_id,cc.requester_name,cc.requester_email,cc.created_at,cc.updated_at,cc.solved_at,cc.closed_at,
      exists(select 1 from chat_events e where e.org_id=cc.org_id and e.conversation_id=cc.id and e.kind='visitor_ended') as visitor_ended,
      latest_message.kind as chat_last_public_message_kind,u.name as assignee_name,u.email as assignee_email
      from chat_conversations cc
      left join lateral (
        select cm.kind from chat_messages cm
        where cm.org_id=cc.org_id and cm.conversation_id=cc.id and cm.kind in ('requester','agent')
        order by cm.created_at desc,cm.id desc limit 1
      ) latest_message on true
      left join "user" u on u.id=cc.assignee_id
      where ${where.join(' and ')}
      order by case when cc.status in ('open','pending','on_hold') and cc.assignee_id is null then 0 else 1 end,
        case when cc.status in ('open','pending','on_hold') and cc.assignee_id is null then cc.created_at end asc nulls last,
        case when cc.status in ('open','pending','on_hold') and cc.assignee_id is not null and latest_message.kind='requester' then 0 else 1 end,
        cc.updated_at desc,cc.id desc limit $${args.length+1} offset $${args.length+2}`,[...args,limit+1,offset])).rows;
    const hasMore=rows.length>limit;if(hasMore)rows.pop();
    const latest="select cm.kind from chat_messages cm where cm.org_id=cc.org_id and cm.conversation_id=cc.id and cm.kind in ('requester','agent') order by cm.created_at desc,cm.id desc limit 1";
    const metadata=(await c.query(`with conversation_counts as (
      select count(*) filter(where cc.status in ('open','pending','on_hold'))::int total,
        count(*) filter(where cc.status in ('open','pending','on_hold') and cc.assignee_id is null)::int waiting,
        count(*) filter(where cc.status in ('open','pending','on_hold') and cc.assignee_id is not null)::int assigned,
        count(*) filter(where cc.status in ('open','pending','on_hold') and cc.assignee_id is not null and (${latest})='requester')::int needs_reply,
        count(*) filter(where cc.status='solved')::int solved,
        count(*) filter(where cc.status='closed')::int closed,
        count(*) filter(where cc.assignee_id=$2 and cc.status in ('open','pending','on_hold'))::int active
      from chat_conversations cc where cc.org_id=$1
    )
    select conversation_counts.*,
      coalesce((select max_concurrent from chat_settings where org_id=$1),3)::int max_concurrent
    from conversation_counts`,
      [orgId,String(input.agentId||'')])).rows[0]||{};
    const max=Math.max(1,Math.min(10,Number(metadata.max_concurrent)||3));
    const active=input.agentId?Number(metadata.active||0):0;
    return{ok:true,tickets:rows.map(r=>({...r,number:Number(r.number),id:Number(r.id)})),counts:{total:Number(metadata.total||0),waiting:Number(metadata.waiting||0),assigned:Number(metadata.assigned||0),needsReply:Number(metadata.needs_reply||0),solved:Number(metadata.solved||0),closed:Number(metadata.closed||0)},capacity:{active,max,remaining:Math.max(0,max-active)},page:{limit,offset,hasMore,nextCursor:null}};
  });
}

// Lightweight notification feed over independent chat messages.
export async function heartbeatChatPresence(pool,orgId,actor,number,typing=false){
 return withOrg(pool,orgId,async c=>{
  const chat=await conversationForNumber(c,orgId,number);if(!chat)return fail('Live Chat conversation not found.',404);
  const access=(await c.query('select chat_access from agent_status where org_id=$1 and user_id=$2',[orgId,actor.id])).rows[0];
  if(!access||access.chat_access!==true)return fail('Live Chat access is required.',403);
  await c.query(`insert into chat_presence(org_id,conversation_id,user_id,name,typing,seen_at) values($1,$2,$3,$4,$5,now())
   on conflict(org_id,conversation_id,user_id) do update set name=excluded.name,typing=excluded.typing,seen_at=now()`,[orgId,chat.id,actor.id,clean(actor.name,100)||actor.email,typing===true]);
  const others=(await c.query("select user_id as id,name,typing,seen_at from chat_presence where org_id=$1 and conversation_id=$2 and user_id<>$3 and seen_at>now()-interval '30 seconds' order by seen_at desc",[orgId,chat.id,actor.id])).rows;
  return{ok:true,others};
 });
}
export async function agentReplyAlerts(pool,orgId,input={}){
 return withOrg(pool,orgId,async c=>{
  if(input.initialize===true){const row=(await c.query("select coalesce(max(id),0)::text cursor from chat_messages where org_id=$1 and kind='requester'",[orgId])).rows[0];return{ok:true,cursor:String(row?.cursor||'0'),replies:[],hasMore:false};}
  const after=/^\\d{1,18}$/.test(String(input.after||''))?String(input.after):'0';
  const rows=(await c.query("select cm.id,cc.chat_number as number,cc.requester_name,cc.requester_email,cc.updated_at,cc.status from chat_messages cm join chat_conversations cc on cc.org_id=cm.org_id and cc.id=cm.conversation_id where cm.org_id=$1 and cm.id>$2::bigint and cm.kind='requester' order by cm.id asc limit 101",[orgId,after])).rows;
  const more=rows.length>100,page=rows.slice(0,100),cursor=page.length?String(page[page.length-1].id):after;
  return{ok:true,cursor,hasMore:more,replies:page.filter(x=>['open','pending','on_hold'].includes(x.status)).map(x=>({number:Number(x.number),requester_name:x.requester_name,requester_email:x.requester_email,updated_at:x.updated_at}))};
 });
}

// Agent detail for the dedicated conversation store; shaped for the existing Live Chat view.
export async function getChatConversation(pool,orgId,number,options={}){
 return withOrg(pool,orgId,async c=>{
  const t=await conversationForNumber(c,orgId,number);
  if(!t)return fail('Live Chat conversation not found.',404);
  const messageLimit=Math.max(1,Math.min(500,Number(options.messageLimit)||50));
  const messages=(await c.query("select id,kind,author_id,author_name,body,html_body,created_at from chat_messages where org_id=$1 and conversation_id=$2 order by created_at desc,id desc limit $3",[orgId,t.id,messageLimit])).rows.reverse();
  const files=messages.length?(await c.query('select id,chat_message_id,filename,content_type,size from attachments where org_id=$1 and chat_message_id=any($2::bigint[]) order by created_at',[orgId,messages.map(m=>m.id)])).rows:[];
  const fileMap={};for(const file of files){const k=String(file.chat_message_id);(fileMap[k]||(fileMap[k]=[])).push({id:file.id,filename:file.filename,content_type:file.content_type,size:file.size});}
  messages.forEach(m=>{m.attachments=fileMap[String(m.id)]||[];});
  const converted=t.converted_ticket_id?(await c.query('select number,subject from tickets where org_id=$1 and id=$2',[orgId,t.converted_ticket_id])).rows[0]||null:null;
  return{ok:true,ticket:{id:t.id,number:Number(t.chat_number),subject:t.subject,status:t.status,channel:'chat',requester_name:t.requester_name,requester_email:t.requester_email,assignee_id:t.assignee_id,assignee:t.assignee_id?{id:t.assignee_id,name:t.assignee_name,email:t.assignee_email}:null,assignee_name:t.assignee_name,assignee_email:t.assignee_email,priority:t.priority,created_at:t.created_at,updated_at:t.updated_at,solved_at:t.solved_at,closed_at:t.closed_at,visitor_ended:t.visitor_ended,provenance:{page_url:t.page_url,page_title:t.page_title,referrer:t.referrer,user_agent:t.user_agent,ip_address:t.ip_address,latitude:t.latitude,longitude:t.longitude},converted_ticket:converted},messages,messagesPage:{limit:500,hasMore:false,nextCursor:null},extras:{followers:[],events:[],sides:[],incidents:[],merged:[],following:false}};
 });
}
export async function agentNoteChat(pool,orgId,actor,number,input={}){
 const body=clean(input.body,2000);if(!body)return fail('Write an internal note first.');
 return withOrg(pool,orgId,async c=>{
  const member=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2',[orgId,actor.id])).rows[0];
  const access=(await c.query('select chat_access from agent_status where org_id=$1 and user_id=$2',[orgId,actor.id])).rows[0];
  if(!member||member.role==='light'||!access||access.chat_access!==true)return fail('Live Chat access is required.',403);
  const chat=await conversationForNumber(c,orgId,number,true);
  if(!chat)return fail('Live Chat conversation not found.',404);
  const m=(await c.query("insert into chat_messages(org_id,conversation_id,kind,author_id,author_name,body) values($1,$2,'note',$3,$4,$5) returning id,kind,author_id,author_name,body,created_at",[orgId,chat.id,actor.id,clean(actor.name,100)||actor.email,body])).rows[0];
  return{ok:true,message:m};
 });
}
export async function agentUpdateChat(pool,orgId,actor,number,patch={},canManage=false){
 return withOrg(pool,orgId,async c=>{
  const member=(await c.query('select m.role,mc.role_id,r.permissions from member m left join member_custom_role mc on mc.org_id=$1 and mc.user_id=m."userId" left join custom_roles r on r.org_id=$1 and r.id=mc.role_id where m."organizationId"=$1 and m."userId"=$2',[orgId,actor.id])).rows[0];
  const access=(await c.query('select chat_access from agent_status where org_id=$1 and user_id=$2',[orgId,actor.id])).rows[0];
  if(!member||member.role==='light'||!access||access.chat_access!==true)return fail('Live Chat access is required.',403);
  if(member.role==='member'&&Array.isArray(member.permissions)&&!member.permissions.includes('reply'))return fail('Your role does not allow you to update live conversations.',403);
  const chat=await conversationForNumber(c,orgId,number,true);
  if(!chat)return fail('Live Chat conversation not found.',404);
  if(chat.status==='closed')return fail('This conversation has ended and cannot be changed.',409);
  if(!canManage&&chat.assignee_id!==actor.id)return fail('Only the assigned agent or an administrator can update this conversation.',403);
  const sets=[],args=[orgId,chat.id];
  const status=String(patch.status||'');
  if(status){
   if(!['open','pending','on_hold','solved'].includes(status))return fail('Choose a valid Live Chat status.');
   if(status==='solved'&&!['solved','closed'].includes(chat.status))sets.push("solved_at=coalesce(solved_at,now())");
   if(status!=='solved')sets.push("solved_at=null");
   args.push(status);sets.push('status=$'+args.length);
  }
  const priority=String(patch.priority||'');
  if(priority){
   if(!['low','normal','high','urgent'].includes(priority))return fail('Choose a valid priority.');
   args.push(priority);sets.push('priority=$'+args.length);
  }
  if(!sets.length)return{ok:true,unchanged:true};
  sets.push('updated_at=now()');
  await c.query('update chat_conversations set '+sets.join(',')+' where org_id=$1 and id=$2',args);
  await c.query("insert into chat_events(org_id,conversation_id,actor_id,actor_name,kind,detail) values($1,$2,$3,$4,'updated',$5)",[orgId,chat.id,actor.id,clean(actor.name,100)||actor.email,'Conversation updated'+(status?' · '+status:'')+(priority?' · '+priority:'')]);
  return{ok:true,updated:true};
 });
}
export async function agentEndChat(pool,orgId,actor,number,canManage=false){
 return withOrg(pool,orgId,async c=>{
  const chat=await conversationForNumber(c,orgId,number,true);
  if(!chat)return fail('Live Chat conversation not found.',404);
  if(['closed','solved'].includes(chat.status))return{ok:true,ended:true,alreadyEnded:true};
  if(!canManage&&chat.assignee_id!==actor.id)return fail('Only the assigned agent or an administrator can end this conversation.',403);
  await c.query("update chat_conversations set status='closed',closed_at=coalesce(closed_at,now()),updated_at=now() where org_id=$1 and id=$2",[orgId,chat.id]);
  await c.query("insert into chat_events(org_id,conversation_id,actor_id,actor_name,kind,detail) values($1,$2,$3,$4,'agent_ended','Agent ended the Live Chat conversation')",[orgId,chat.id,actor.id,clean(actor.name,100)||actor.email]);
  return{ok:true,ended:true};
 });
}
export async function agentReplyChat(pool,orgId,actor,number,input={}){
 const body=clean(input.body,20000), attachmentIds=Array.isArray(input.attachmentIds)?[...new Set(input.attachmentIds.map(String))].slice(0,5):[];if(!body&&!attachmentIds.length)return fail('Write a reply or attach a file.');
 return withOrg(pool,orgId,async c=>{
  const member=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2 for update',[orgId,actor.id])).rows[0];
  if(!member||member.role==='light')return fail('You are not allowed to reply to live chats.',403);
  const access=(await c.query('select chat_access,chat_available from agent_status where org_id=$1 and user_id=$2 for update',[orgId,actor.id])).rows[0];
  if(!access||access.chat_access!==true)return fail('An admin must enable Live Chat access for you first.',403);
  const chat=await conversationForNumber(c,orgId,number,true);
  if(!chat)return fail('Live Chat conversation not found.',404);
  if(!['open','pending','on_hold'].includes(chat.status))return fail('This conversation has ended.',409);
  if(chat.assignee_id&&chat.assignee_id!==actor.id)return fail('This live chat is assigned to another agent.',409);
  if(!chat.assignee_id){
    if(access.chat_available!==true)return fail('Switch on Accept live chats before replying.',409);
    await c.query('update chat_conversations set assignee_id=$3,updated_at=now() where org_id=$1 and id=$2',[orgId,chat.id,actor.id]);
    await c.query("insert into chat_events(org_id,conversation_id,actor_id,actor_name,kind,detail) values($1,$2,$3,$4,'assigned','Agent accepted the conversation')",[orgId,chat.id,actor.id,clean(actor.name,100)||actor.email]);
  }
  const key=clean(input.idempotencyKey,80)||null;
  if(key){const old=(await c.query('select id,kind,author_id,author_name,body,created_at from chat_messages where org_id=$1 and conversation_id=$2 and author_id=$3 and idempotency_key=$4',[orgId,chat.id,actor.id,key])).rows[0];if(old){if(attachmentIds.length)await c.query("update attachments set chat_message_id=$4 where org_id=$1 and chat_conversation_id=$2 and id=any($3::text[]) and chat_message_id is null and message_id is null and uploaded_by=$5",[orgId,chat.id,attachmentIds,old.id,actor.id]);return{ok:true,duplicate:true,message:old};}}
  const m=(await c.query("insert into chat_messages(org_id,conversation_id,kind,author_id,author_name,body,idempotency_key) values($1,$2,'agent',$3,$4,$5,$6) returning id,kind,author_id,author_name,body,created_at",[orgId,chat.id,actor.id,clean(actor.name,100)||actor.email,body,key])).rows[0];
  if(attachmentIds.length)await c.query("update attachments set chat_message_id=$4 where org_id=$1 and chat_conversation_id=$2 and id=any($3::text[]) and chat_message_id is null and message_id is null and uploaded_by=$5",[orgId,chat.id,attachmentIds,m.id,actor.id]);
  await c.query("update chat_conversations set updated_at=now() where org_id=$1 and id=$2",[orgId,chat.id]);
  return{ok:true,message:m};
 });
}

 // Queue only after the visitor has stopped polling. A recent visitor heartbeat means
 // the reply is already visible in the live widget and should not also trigger email.
 export async function enqueueChatReplyEmail(pool,orgId,number,messageId){
  const mark=delivery=>withOrg(pool,orgId,c=>c.query("update chat_messages set delivery=$3 where org_id=$1 and id=$2 and kind='agent'",[orgId,String(messageId),delivery]));
  try{
   const data=await withOrg(pool,orgId,async c=>{
    const row=(await c.query(`select cc.id as conversation_id,cc.chat_number,cc.requester_email,cc.requester_name,cc.subject,cc.last_visitor_seen_at,
     cm.id as message_id,cm.kind,cm.body,cm.author_name,cm.delivery,o.name as org_name
     from chat_conversations cc join chat_messages cm on cm.org_id=cc.org_id and cm.conversation_id=cc.id
     join "organization" o on o.id=cc.org_id
     where cc.org_id=$1 and cc.chat_number=$2 and cm.id=$3 and cm.kind='agent'`,[orgId,Number(number)||0,String(messageId)])).rows[0];
    return row||null;
   });
   if(!data)return{delivery:'skipped',why:'missing'};
   if(!data.requester_email||!isEmail(data.requester_email)){await mark('skipped');return{delivery:'skipped',why:'no-email'};}
   const visitorOnline=data.last_visitor_seen_at&&new Date(data.last_visitor_seen_at).getTime()>Date.now()-45000;
   if(visitorOnline){await mark('skipped');return{delivery:'skipped',why:'visitor-online'};}
   if(data.delivery==='sent')return{delivery:'sent'};
   const job=await enqueueJob(pool,orgId,{type:'chat.email.deliver',payload:{number:Number(number),conversationId:String(data.conversation_id),messageId:String(messageId)},idempotencyKey:'chat-message:'+String(messageId),maxAttempts:8});
   if(job.status==='failed'){await mark('failed');return{delivery:'failed',why:'delivery-exhausted'};}
   await mark(job.status==='succeeded'?'sent':'queued');
   return{delivery:job.status==='succeeded'?'sent':'queued',jobId:job.id};
  }catch(error){
   logWarn('live_chat.email_queue_failed',{error:error.message,orgId,number});
   await mark('failed').catch(()=>{});
   return{delivery:'failed',why:'queue-error'};
  }
 }

export async function startChat(pool,env,slug,input,mailer,provenance={}){
 const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
 const hours = chatHoursStatus(x.settings, provenance.nowMs || Date.now()), contactRequest = x.settings.availability_enabled === true && !hours.open;
 if (contactRequest && x.settings.after_hours_mode === 'hide') return fail('Live Chat is currently closed. Please contact the team during business hours.', 403);
 const name=clean(input.name,100),email=clean(input.email,254).toLowerCase(),body=clean(input.message,2000);
 if(!isEmail(email))return fail('Enter your email address so we can reach you if you leave.');if(!body)return fail('Write your message.');
 const visitorId=clean(input.visitorId,64),visitorKey=/^[a-f0-9]{64}$/i.test(visitorId)?crypto.createHash('sha256').update(x.org.id+':'+visitorId.toLowerCase()).digest('hex'):null;
 const reuseDays=Number(x.settings.reuse_days??DEFAULTS.reuse_days),cooldown=Math.max(0,Math.min(3600,Number(x.settings.restart_cooldown_seconds??15)));
 const result=await withOrg(pool,x.org.id,async c=>{
  if(visitorKey)await c.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[x.org.id,visitorKey]);
  if(cooldown>0){const ended=(await c.query("select greatest(1,ceil(extract(epoch from (e.created_at+($4::int*interval '1 second')-now())))::int) retry_after from chat_events e join chat_conversations cc on cc.org_id=e.org_id and cc.id=e.conversation_id where e.org_id=$1 and e.kind='visitor_ended' and lower(cc.requester_email)=lower($3) and e.created_at>now()-($4::int*interval '1 second') and ($2::text is null or cc.visitor_key=$2) order by e.created_at desc limit 1",[x.org.id,visitorKey,email,cooldown])).rows[0];if(ended)return{ok:false,status:429,error:'Please wait '+ended.retry_after+' seconds before starting another chat.',retryAfterSeconds:Number(ended.retry_after)};}
  let existing=null;if(!contactRequest&&visitorKey&&reuseDays>0)existing=(await c.query("select id,chat_number,status from chat_conversations where org_id=$1 and visitor_key=$2 and lower(requester_email)=lower($3) and ((status in ('open','pending','on_hold') and updated_at>=now()-($4::int*interval '1 day')) or (status='solved' and solved_at>=now()-($4::int*interval '1 day'))) order by updated_at desc,id desc limit 1 for update",[x.org.id,visitorKey,email,reuseDays])).rows[0]||null;
  let id,chatNumber;if(existing){id=existing.id;chatNumber=existing.chat_number;await c.query("update chat_conversations set status='open',closed_at=null,solved_at=null,updated_at=now(),last_visitor_seen_at=now() where org_id=$1 and id=$2",[x.org.id,id]);if(existing.status==='solved')await c.query("insert into chat_events(org_id,conversation_id,actor_name,kind,detail) values($1,$2,$3,'visitor_returned','Visitor reopened the recently resolved conversation')",[x.org.id,id,name||email]);}
  else{const created=(await c.query(`insert into chat_conversations(org_id,subject,requester_name,requester_email,visitor_key,priority,page_url,page_title,referrer,user_agent,ip_address,source,status,last_visitor_seen_at)
    values($1,$2,$3,$4,$5,'normal',$6,$7,$8,$9,$10,$11,$12,now()) returning id,chat_number`,
    [x.org.id,(contactRequest?'Contact request: ':'Chat: ')+body.replace(/\s+/g,' ').slice(0,60),name,email,visitorKey,safePageUrl(provenance.pageUrl),clean(provenance.pageTitle,200)||null,safePageUrl(provenance.referrer),clean(provenance.userAgent,500)||null,safeIp(provenance.ip),contactRequest?'widget_contact':'widget',contactRequest?'pending':'open'])).rows[0];id=created.id;chatNumber=created.chat_number;}
  await c.query("insert into chat_messages(org_id,conversation_id,kind,author_name,body) values($1,$2,'requester',$3,$4)",[x.org.id,id,name||email,body]);
  await c.query("update chat_conversations set visitor_token_hash=$3,updated_at=now(),last_visitor_seen_at=now() where org_id=$1 and id=$2",[x.org.id,id,crypto.createHash('sha256').update(chatToken(env,x.org.id,chatNumber)).digest('hex')]);
  await c.query("insert into chat_events(org_id,conversation_id,actor_name,kind,detail) values($1,$2,$3,$4,$5)",[x.org.id,id,name||email,contactRequest?'after_hours_contact_request':(existing?'visitor_returned':'visitor_started'),contactRequest?'Visitor submitted an after-hours contact request':(existing?'Visitor returned to the conversation':'Visitor started a Live Chat conversation')]);
  const current=(await c.query('select assignee_id from chat_conversations where org_id=$1 and id=$2',[x.org.id,id])).rows[0];
  if(!current?.assignee_id && !contactRequest)await autoAssignChat(c,x.org.id,id);
  return{ok:true,number:Number(chatNumber),reused:!!existing};
 });
 if(!result.ok)return result;
 await emit(pool,x.org.id,'message.customer',result.number,{message:{body}});
 if(x.settings.auto_convert_to_ticket===true && !contactRequest){try{const converted=await convertChatToTicket(pool,x.org.id,null,result.number);if(converted.ok)result.ticketNumber=converted.number;else logWarn('live_chat.auto_conversion_failed',{org:x.org.id,conversation:result.number,error:converted.error});}catch(error){logError('live_chat.auto_conversion_exception',{org:x.org.id,conversation:result.number,error});}}
 return{ok:true,number:result.number,token:chatToken(env,x.org.id,result.number),reused:result.reused===true,orgId:x.org.id,...(result.ticketNumber?{ticketNumber:result.ticketNumber}:{})};
}

// Convert a dedicated conversation to a ticket only when an agent chooses or an admin enables automation.
export async function convertChatToTicket(pool,orgId,actor,number){
 return withOrg(pool,orgId,async c=>{
  const src=await conversationForNumber(c,orgId,number,true);
  if(!src)return fail('Live Chat conversation not found.',404);
  if(src.converted_ticket_id){const old=(await c.query('select number,subject from tickets where org_id=$1 and id=$2',[orgId,src.converted_ticket_id])).rows[0];return old?{ok:true,number:old.number,subject:old.subject,alreadyConverted:true}:fail('The linked ticket could not be found.',409);}
  const msgs=(await c.query("select id,kind,author_id,author_name,body,html_body,created_at from chat_messages where org_id=$1 and conversation_id=$2 and kind in ('requester','agent','note') order by created_at,id limit 10000",[orgId,src.id])).rows;
  if(!msgs.length)return fail('This conversation has no transcript to copy.');
  const made=await createTicket(pool,orgId,actor,{subject:('Follow-up: '+String(src.subject||'Live Chat').replace(/^\s*chat\s*:\s*/i,'')).slice(0,200),body:'Transcript imported from Live Chat conversation #'+number+'.',requesterName:src.requester_name,requesterEmail:src.requester_email,priority:src.priority,channel:'web',firstKind:'note'},c);
  if(!made.ok)return made;
  await c.query('update tickets set source_chat_conversation_id=$3 where org_id=$1 and id=$2',[orgId,made.ticket.id,src.id]);
  await c.query('delete from ticket_messages where org_id=$1 and id=$2',[orgId,made.messageRowId]);
  for(const m of msgs){
   const copied=(await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body,html_body,created_at) values($1,$2,$3,$4,$5,$6,$7,$8) returning id',[orgId,made.ticket.id,m.kind,m.author_id,m.author_name,(String(m.body||'').trim()?m.body:'[Attachment]'),m.html_body,m.created_at])).rows[0];
   await c.query('update attachments set ticket_id=$3,message_id=$4,chat_conversation_id=null,chat_message_id=null where org_id=$1 and chat_message_id=$2',[orgId,m.id,made.ticket.id,copied.id]);
  }
  await c.query('update chat_conversations set converted_ticket_id=$3,updated_at=now() where org_id=$1 and id=$2',[orgId,src.id,made.ticket.id]);
  await c.query("insert into chat_events(org_id,conversation_id,actor_id,actor_name,kind,detail) values($1,$2,$3,$4,'converted',$5)",[orgId,src.id,actor?.id||null,actor?.name||actor?.email||'Automation','Converted to support ticket #'+made.ticket.number]);
  return{ok:true,number:made.ticket.number,subject:made.ticket.subject,alreadyConverted:false};
 });
}

export async function endChat(pool,env,slug,input){
 const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
 const number=Number(input.number)||0;if(!tokenOk(env,x.org.id,number,input.token))return fail('This chat is not yours.',403);
 return withOrg(pool,x.org.id,async c=>{
  const t=await conversationForNumber(c,x.org.id,number,true);
  if(!t)return fail('No such chat.',404);if(['closed','solved'].includes(t.status))return{ok:true,ended:true,alreadyEnded:true};
  await c.query("update chat_conversations set status='closed',closed_at=coalesce(closed_at,now()),updated_at=now() where org_id=$1 and id=$2",[x.org.id,t.id]);
  await c.query("insert into chat_events(org_id,conversation_id,actor_name,kind,detail) values($1,$2,'Website visitor','visitor_ended','Visitor ended the Live Chat conversation')",[x.org.id,t.id]);
  return{ok:true,ended:true};
 });
}

const transcriptEscape = value => String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
export async function requestChatTranscript(pool,env,slug,input,mailer){
 const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
 const number=Number(input.number)||0;if(!tokenOk(env,x.org.id,number,input.token))return fail('This chat is not yours.',403);
 if(!mailer||typeof mailer.ticketMail!=='function')return fail('Transcript email is temporarily unavailable. Please try again later.',503);
 const data=await withOrg(pool,x.org.id,async c=>{
  const t=await conversationForNumber(c,x.org.id,number);if(!t)return null;
  const messages=(await c.query("select kind,author_name,body,created_at from chat_messages where org_id=$1 and conversation_id=$2 and kind in ('requester','agent') order by created_at asc,id asc limit 501",[x.org.id,t.id])).rows;
  return{ticket:t,messages};
 });
 if(!data)return fail('No such chat.',404);
 if(!isEmail(String(data.ticket.requester_email||'')))return fail('There is no valid email address on this conversation. Please contact the support team.',400);
 const truncated=data.messages.length>500,messages=data.messages.slice(0,500);
 const lines=messages.map(m=>'['+(m.created_at?new Date(m.created_at).toISOString():'')+'] '+(m.kind==='agent'?(m.author_name||'Support agent'):(data.ticket.requester_name||'You'))+':\\n'+String(m.body||''));
 if(truncated)lines.push('[Transcript shortened to the most recent 500 messages.]');
 const html='<!doctype html><html><body style="font-family:Arial,sans-serif;color:#202a33;line-height:1.5"><h1>Your support conversation</h1><p>'+transcriptEscape(x.org.name)+' · Conversation #'+number+'</p>'+messages.map(m=>'<section style="padding:12px 0;border-bottom:1px solid #e5e9ed"><strong>'+transcriptEscape(m.kind==='agent'?(m.author_name||'Support agent'):(data.ticket.requester_name||'You'))+'</strong><small style="display:block;color:#66737d">'+transcriptEscape(m.created_at?new Date(m.created_at).toISOString():'')+'</small><p style="white-space:pre-wrap">'+transcriptEscape(m.body)+'</p></section>').join('')+(truncated?'<p>Transcript limited to the most recent 500 messages.</p>':'')+'<p style="color:#66737d;font-size:12px">Internal notes and private agent-only content are excluded.</p></body></html>';
 await mailer.ticketMail({to:data.ticket.requester_email,subject:'Your support conversation transcript · #'+number,text:'Your support conversation with '+x.org.name+' · #'+number+'\\n\\n'+lines.join('\\n\\n')+'\\n\\nInternal notes are excluded.',html});
 await withOrg(pool,x.org.id,c=>c.query("insert into chat_events(org_id,conversation_id,actor_name,kind,detail) values($1,$2,'Website visitor','transcript_requested','Visitor requested an emailed transcript')",[x.org.id,data.ticket.id]));
 return{ok:true,sent:true};
}

export async function sendChat(pool,env,slug,input,mailer){
 const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
 const number=Number(input.number)||0;if(!tokenOk(env,x.org.id,number,input.token))return fail('This chat is not yours.',403);
 const body=clean(input.message,2000), attachmentIds=Array.isArray(input.attachmentIds)?[...new Set(input.attachmentIds.map(String))].slice(0,5):[];if(!body&&!attachmentIds.length)return fail('Write a message or attach a file.');
 const result=await withOrg(pool,x.org.id,async c=>{
  const t=await conversationForNumber(c,x.org.id,number,true);
  if(!t)return fail('No such chat.',404);if(['closed','solved'].includes(t.status))return fail('This chat has ended. Start a new one.',409);
  const m=(await c.query("insert into chat_messages(org_id,conversation_id,kind,author_name,body) values($1,$2,'requester',$3,$4) returning id",[x.org.id,t.id,t.requester_name||t.requester_email,body])).rows[0];
  if(attachmentIds.length) await c.query("update attachments set chat_message_id=$4 where org_id=$1 and chat_conversation_id=$2 and id=any($3::text[]) and chat_message_id is null and message_id is null and uploaded_by is null",[x.org.id,t.id,attachmentIds,m.id]);
  await c.query("update chat_conversations set updated_at=now(),last_visitor_seen_at=now() where org_id=$1 and id=$2",[x.org.id,t.id]);
  return{ok:true,id:Number(m.id)};
 });
 if(result.ok)await emit(pool,x.org.id,'message.customer',number,{message:{body}});
 return result;
}

// The visitor heartbeat is throttled: polls can arrive every few seconds, but presence
// only needs refreshing every 15 seconds to remain safely inside chatOpen's 45-second window.
export async function updateChatContext(pool,env,slug,input){
 const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
 const number=Number(input.number)||0;if(!tokenOk(env,x.org.id,number,input.token))return fail('This chat is not yours.',403);
 const pageUrl=clean(input.pageUrl,2048),pageTitle=clean(input.pageTitle,200),hasLat=input.latitude!==undefined&&input.latitude!==null&&input.latitude!=='',hasLon=input.longitude!==undefined&&input.longitude!==null&&input.longitude!=='';
 if(hasLat!==hasLon)return fail('Share both location coordinates together.');
 let lat=null,lon=null;if(hasLat){lat=Number(input.latitude);lon=Number(input.longitude);if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)return fail('The shared location is not valid.');lat=Math.round(lat*100)/100;lon=Math.round(lon*100)/100;}
 let parsed;try{parsed=new URL(pageUrl);}catch{return fail('A valid page URL is required.');}
 if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)return fail('A valid page URL is required.');parsed.search='';parsed.hash='';
 return withOrg(pool,x.org.id,async c=>{
  const chat=await conversationForNumber(c,x.org.id,number,true);if(!chat||['closed','solved'].includes(chat.status))return fail('This chat has ended.',409);
  await c.query("update chat_conversations set page_url=$3,page_title=$4,latitude=case when $5::boolean then $6::double precision else latitude end,longitude=case when $5::boolean then $7::double precision else longitude end,last_visitor_seen_at=now(),updated_at=now() where org_id=$1 and id=$2",[x.org.id,chat.id,parsed.href.slice(0,2048),pageTitle||null,hasLat,lat,lon]);return{ok:true};
 });
}

export async function pollChat(pool,env,slug,number,token,after){
  const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
  number=Number(number)||0;if(!tokenOk(env,x.org.id,number,token))return fail('This chat is not yours.',403);
  return withOrg(pool,x.org.id,async c=>{
    // One tenant-scoped SQL round trip now resolves the conversation, refreshes visitor
    // presence, fetches recent messages + attachments, and checks agent typing.
    const t=(await c.query(`
      with target as materialized (
        select cc.id,cc.status,cc.assignee_id,u.name as assignee_name,u.email as assignee_email
        from chat_conversations cc
        left join tickets legacy_ticket on legacy_ticket.org_id=cc.org_id and legacy_ticket.id=cc.source_ticket_id
        left join "user" u on u.id=cc.assignee_id
        where cc.org_id=$1 and (cc.chat_number=$2 or legacy_ticket.number=$2 or cc.id=$2)
        order by (cc.chat_number=$2) desc,(legacy_ticket.number=$2) desc
        limit 1
      ), heartbeat as (
        update chat_conversations cc
        set last_visitor_seen_at=case
          when cc.last_visitor_seen_at is null or cc.last_visitor_seen_at<now()-interval '15 seconds' then now()
          else cc.last_visitor_seen_at end
        from target t
        where cc.org_id=$1 and cc.id=t.id and t.status not in ('closed','solved')
        returning cc.id
      ), recent_messages as materialized (
        select cm.id,cm.kind,cm.author_name,cm.body,cm.created_at
        from chat_messages cm join target t on t.id=cm.conversation_id
        where cm.org_id=$1 and cm.kind in ('requester','agent') and cm.id>$3
        order by cm.id limit 100
      )
      select t.id,t.status,t.assignee_id,t.assignee_name,t.assignee_email,
        exists(select 1 from chat_presence p where p.org_id=$1 and p.conversation_id=t.id
          and p.user_id not like 'visitor:%' and p.typing=true and p.seen_at>now()-interval '15 seconds') as agent_typing,
        coalesce((select jsonb_agg(jsonb_build_object(
          'id',rm.id,'kind',rm.kind,'author_name',rm.author_name,'body',rm.body,'created_at',rm.created_at,
          'attachments',coalesce((select jsonb_agg(jsonb_build_object(
            'id',a.id,'filename',a.filename,'content_type',a.content_type,'size',a.size
          ) order by a.created_at) from attachments a where a.org_id=$1 and a.chat_message_id=rm.id),'[]'::jsonb)
        ) order by rm.id) from recent_messages rm),'[]'::jsonb) as messages,
        hb.updated_count
      from target t cross join (select count(*)::int as updated_count from heartbeat) hb
    `,[x.org.id,number,Number(after)||0])).rows[0];
    if(!t)return fail('No such chat.',404);
    return{ok:true,ended:['closed','solved'].includes(t.status),assigned:!!t.assignee_id,
      agentName:t.assignee_name||t.assignee_email||'',agentTyping:t.agent_typing===true,
      messages:(t.messages||[]).map(m=>({id:Number(m.id),from:m.kind==='agent'?'agent':'you',
        name:m.kind==='agent'?m.author_name:'',body:m.body,at:m.created_at,attachments:m.attachments||[]}))};
  });
}

// Whether the visitor's widget is actively polling a dedicated conversation.
export async function chatOpen(pool,orgId,number){
 return withOrg(pool,orgId,async c=>{const chat=await conversationForNumber(c,orgId,number);return !!(chat&&chat.last_visitor_seen_at&&new Date(chat.last_visitor_seen_at).getTime()>Date.now()-45000);});
}

// Resolve inactive chats hourly. A visitor whose chat window is still polling is
// considered present; fresh ticket activity also protects conversations being handled.
export async function runChatLifecycle(pool,nowMs=Date.now()){
 let actions=0,errors=0;const now=new Date(nowMs).toISOString();
 const orgs=(await pool.query('select id from "organization"')).rows;
 for(const {id:orgId} of orgs){try{
  const settings=await getSettings(pool,orgId),hours=Number(settings.auto_resolve_hours??DEFAULTS.auto_resolve_hours);if(!hours)continue;
  const count=await withOrg(pool,orgId,async c=>{
   const stale=await c.query(`update chat_conversations set status='solved',solved_at=coalesce(solved_at,$2::timestamptz),updated_at=$2::timestamptz
    where org_id=$1 and status in ('open','pending','on_hold') and updated_at<=$2::timestamptz-($3::int*interval '1 hour')
    and (last_visitor_seen_at is null or last_visitor_seen_at<=$2::timestamptz-interval '45 seconds') returning id`,[orgId,now,hours]);
   for(const row of stale.rows)await c.query("insert into chat_events(org_id,conversation_id,actor_name,kind,detail) values($1,$2,'Live Chat automation','auto_resolved',$3)",[orgId,row.id,'Automatically resolved after '+hours+' hours without activity']);
   return stale.rowCount;
  });actions+=count;
 }catch(e){errors++;console.warn('Live Chat lifecycle failed',orgId,e.message);}}
 return{actions,errors};
}

// ---- the public endpoints: /api/chat/config, /start, /send, /poll (same origin as the chat page, so no cross-site access is given) ----
const hits = new Map();
const tooMany = (pool, key, now, max) => rateLimit(pool, 'chat:' + key, max, 60, now);
const json = (status, body, extraHeaders = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extraHeaders } });
export async function chatApi(req, { pool, mailer, store, env = process.env, now = Date.now() }) {
  const u = new URL(req.url), act = u.pathname.replace(/^\/api\/chat\/?/, '').split('/')[0], ip = clientIp(req, env);
  const slug = u.searchParams.get('org') || '';
  try {
    // This endpoint exposes only public widget presentation/availability settings. The embed script calls it from the customer's site, so it must be readable cross-origin.
    if (act === 'config' && req.method === 'GET') { const config = await publicConfig(pool, slug); if (config.logo && config.logo.startsWith('/')) config.logo = new URL(config.logo, u.origin).href; return json(200, config, { 'Access-Control-Allow-Origin': '*' }); }
    if (act === 'poll' && req.method === 'GET') { const tokenKey=crypto.createHash('sha256').update(String(u.searchParams.get('t')||'')).digest('hex').slice(0,32); if (await tooMany(pool, 'p' + tokenKey, now, 60) || await tooMany(pool, 'pip' + ip, now, 1200)) return json(429, { error: 'Slow down.' }); const r = await pollChat(pool, env, slug, u.searchParams.get('n'), u.searchParams.get('t'), u.searchParams.get('after')); return json(r.ok ? 200 : r.status, r); }
    if (act === 'file' && req.method === 'GET') {
      const x=await liveOrg(pool,slug),number=Number(u.searchParams.get('n'))||0,token=u.searchParams.get('t')||'',id=u.searchParams.get('id')||'';
      if(!x||!tokenOk(env,x.org.id,number,token))return json(404,{error:'File not found.'});
      const chat=await withOrg(pool,x.org.id,async c=>(await c.query('select id from chat_conversations where org_id=$1 and chat_number=$2',[x.org.id,number])).rows[0]);
      const file=await readFile(pool,store,x.org.id,id);
      if(!chat||!file||String(file.chat_conversation_id)!==String(chat.id)||!file.chat_message_id)return json(404,{error:'File not found.'});
      const imageType=String(file.content_type||'').toLowerCase(),inline=u.searchParams.get('inline')==='1'&&['image/png','image/jpeg','image/gif','image/webp'].includes(imageType); return new Response(file.bytes,{status:200,headers:{'Content-Type':inline?imageType:'application/octet-stream','Content-Disposition':(inline?'inline':'attachment')+'; filename="'+cleanName(file.filename)+'"','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':'private, no-store','Content-Length':String(file.bytes.length)}});
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    const o = req.headers.get('origin'); if (o && new URL(o).host !== u.host) return json(403, { error: 'Bad origin.' });
    if(act==='upload'){
      const uploadKey=crypto.createHash('sha256').update(String(u.searchParams.get('t')||'')).digest('hex').slice(0,32); if(await tooMany(pool,'up'+uploadKey,now,20)||await tooMany(pool,'upip'+ip,now,120))return json(429,{error:'Too many files uploaded. Try again shortly.'});
      if(Number(req.headers.get('content-length')||0)>MAX_UPLOAD+1024)return json(413,{error:'Files can be up to 5 MB each.'});
      const x=await liveOrg(pool,slug),number=Number(u.searchParams.get('n'))||0,token=u.searchParams.get('t')||'';
      if(!x||!tokenOk(env,x.org.id,number,token))return json(403,{error:'This chat is not yours.'});
      const reader=req.body&&req.body.getReader?req.body.getReader():null;if(!reader)return json(400,{error:'Choose a file first.'});
      const chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>MAX_UPLOAD){await reader.cancel().catch(()=>{});return json(413,{error:'Files can be up to 5 MB each.'});}chunks.push(Buffer.from(part.value));}
      const bytes=Buffer.concat(chunks,size),result=await saveChatUpload(pool,store,x.org.id,null,{filename:u.searchParams.get('name'),contentType:u.searchParams.get('type')||req.headers.get('content-type'),bytes,chatNumber:number});
      return result.ok?json(200,result):json(result.status||400,{error:result.error});
    }
    const text = await req.text(); if (text.length > 10000) return json(413, { error: 'Too long.' });
    let b; try { b = JSON.parse(text || '{}'); } catch { return json(400, { error: 'Bad request.' }); }
    if (act === 'start') { if (await tooMany(pool, 's' + ip, now, 6)) return json(429, { error: 'Too many chats started. Wait a minute.' }); const r = await startChat(pool, env, slug, b, mailer, {ip,pageUrl:b.pageUrl,pageTitle:b.pageTitle,referrer:req.headers.get('referer'),userAgent:req.headers.get('user-agent'),identityType:'visitor',nowMs:now}); if (r.ok) delete r.orgId; return json(r.ok ? 200 : r.status, r); }
    if (act === 'context') { if (await tooMany(pool, 'cx' + ip, now, 30)) return json(429, { error: 'Slow down.' }); const r = await updateChatContext(pool, env, slug, b); return json(r.ok ? 200 : r.status, r); }
    if (act === 'typing') { const typingKey=crypto.createHash('sha256').update(String(b.token||'')).digest('hex').slice(0,32); if (await tooMany(pool, 'ty' + typingKey, now, 30) || await tooMany(pool, 'tyip' + ip, now, 600)) return json(429, { error: 'Slow down.' }); const x = await liveOrg(pool, slug); if (!x) return json(404, { error: 'Chat is not available.' }); const number = Number(b.number) || 0; if (!tokenOk(env, x.org.id, number, b.token)) return json(403, { error: 'This chat is not yours.' }); const visitorId = 'visitor:' + crypto.createHash('sha256').update(String(b.token)).digest('hex').slice(0, 32); const result = await withOrg(pool, x.org.id, async c => { const conversation = await conversationForNumber(c, x.org.id, number); if (!conversation || ['closed','solved'].includes(conversation.status)) return fail('This chat has ended.', 409); await c.query("insert into chat_presence(org_id,conversation_id,user_id,name,typing,seen_at) values($1,$2,$3,'Website visitor',$4,now()) on conflict(org_id,conversation_id,user_id) do update set typing=excluded.typing,seen_at=now()", [x.org.id, conversation.id, visitorId, b.typing === true]); return { ok: true }; }); return json(result.ok ? 200 : result.status, result); }
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