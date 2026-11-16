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
export const DEFAULTS = { enabled: false, title: 'Chat with us', greeting: 'Hi! Ask us anything. We reply here, and by email if you leave.', color: '#1f73b7', logo_url: null, max_concurrent: 3, auto_resolve_hours: 24, reuse_days: 7, restart_cooldown_seconds: 15, auto_convert_to_ticket: false };

export async function getSettings(pool, orgId) {
  return withOrg(pool, orgId, async c => { const r = (await c.query('select enabled, title, greeting, color, logo_url, max_concurrent, auto_resolve_hours, reuse_days, restart_cooldown_seconds, auto_convert_to_ticket from chat_settings where org_id = $1', [orgId])).rows[0]; return { ...DEFAULTS, ...(r || {}) }; });
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
  const autoConvertToTicket = input.autoConvertToTicket === true;
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10) return fail('Maximum simultaneous chats must be a whole number from 1 to 10.');
  if (!Number.isInteger(autoResolveHours) || autoResolveHours < 0 || autoResolveHours > 720) return fail('Automatic chat resolution must be 0 (off) or between 1 and 720 hours.');
  if (!Number.isInteger(reuseDays) || reuseDays < 0 || reuseDays > 30) return fail('Conversation reuse must be 0 (off) or between 1 and 30 days.');
  if (!Number.isInteger(restartCooldownSeconds) || restartCooldownSeconds < 0 || restartCooldownSeconds > 3600) return fail('The visitor restart cooldown must be a whole number from 0 to 3600 seconds.');
  await withOrg(pool, orgId, c => c.query('insert into chat_settings (org_id, enabled, title, greeting, color, logo_url, max_concurrent, auto_resolve_hours, reuse_days, restart_cooldown_seconds, auto_convert_to_ticket) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (org_id) do update set enabled = $2, title = $3, greeting = $4, color = $5, logo_url = $6, max_concurrent = $7, auto_resolve_hours = $8, reuse_days = $9, restart_cooldown_seconds = $10, auto_convert_to_ticket = $11, updated_at = now()', [orgId, enabled, title, greeting, color, logoUrl || null, maxConcurrent, autoResolveHours, reuseDays, restartCooldownSeconds, autoConvertToTicket]));
  return { ok: true, settings: { enabled, title, greeting, color, logo_url: logoUrl || null, max_concurrent: maxConcurrent, auto_resolve_hours: autoResolveHours, reuse_days: reuseDays, restart_cooldown_seconds: restartCooldownSeconds, auto_convert_to_ticket: autoConvertToTicket } };
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
  return { ok: true, enabled: true, accepting: online, name: x.org.name, title: x.settings.title, greeting: x.settings.greeting, color: x.settings.color, logo: x.settings.logo_url || null, restartCooldownSeconds: Number(x.settings.restart_cooldown_seconds ?? DEFAULTS.restart_cooldown_seconds) };
}

// Independent, tenant-scoped Live Chat inbox. Conversation ids are stable chat numbers.
export async function agentInbox(pool, orgId, input = {}) {
  const limit=Math.min(Math.max(parseInt(input.limit,10)||40,1),100),view=['all','waiting','needs-reply','mine','history'].includes(input.view)?input.view:'all',q=clean(input.q,100).toLowerCase();
  return withOrg(pool,orgId,async c=>{
    const args=[orgId],where=['cc.org_id=$1'];
    where.push(view==='history'?"cc.status in ('solved','closed')":"cc.status in ('open','pending','on_hold')");
    if(view==='waiting')where.push('cc.assignee_id is null');
    if(view==='mine'){args.push(String(input.agentId||''));where.push('cc.assignee_id=$'+args.length);}
    if(q){args.push('%'+q.replace(/[\\%_]/g,'\\$&')+'%');where.push('(lower(cc.requester_name) like $'+args.length+' or lower(cc.requester_email) like $'+args.length+' or lower(cc.subject) like $'+args.length+')');}
    const latest="select cm.kind from chat_messages cm where cm.org_id=cc.org_id and cm.conversation_id=cc.id and cm.kind in ('requester','agent') order by cm.created_at desc,cm.id desc limit 1";
    if(view==='needs-reply')where.push('('+latest+")='requester'");
    const offset=Math.max(0,Math.min(parseInt(input.offset,10)||0,1000000));
    const rows=(await c.query(`select cc.id as number,cc.id,cc.subject,cc.status,cc.assignee_id,cc.requester_name,cc.requester_email,cc.created_at,cc.updated_at,cc.solved_at,cc.closed_at,
      exists(select 1 from chat_events e where e.org_id=cc.org_id and e.conversation_id=cc.id and e.kind='visitor_ended') as visitor_ended,
      (${latest}) as chat_last_public_message_kind,u.name as assignee_name,u.email as assignee_email
      from chat_conversations cc left join "user" u on u.id=cc.assignee_id where ${where.join(' and ')}
      order by case when cc.assignee_id is null then 0 else 1 end,cc.updated_at desc,cc.id desc limit $${args.length+1} offset $${args.length+2}`,[...args,limit+1,offset])).rows;
    const hasMore=rows.length>limit;if(hasMore)rows.pop();
    const counts=(await c.query(`select count(*)::int total,count(*) filter(where status in ('open','pending','on_hold') and assignee_id is null)::int waiting,
      count(*) filter(where status in ('open','pending','on_hold') and assignee_id is not null)::int assigned,
      count(*) filter(where status in ('open','pending','on_hold') and assignee_id is not null and (${latest})='requester')::int needs_reply,
      count(*) filter(where status='solved')::int solved,count(*) filter(where status='closed')::int closed from chat_conversations cc where cc.org_id=$1`,[orgId])).rows[0]||{};
    const max=Math.max(1,Math.min(10,Number((await c.query('select max_concurrent from chat_settings where org_id=$1',[orgId])).rows[0]?.max_concurrent)||3));
    const active=input.agentId?Number((await c.query("select count(*)::int n from chat_conversations where org_id=$1 and assignee_id=$2 and status in ('open','pending','on_hold')",[orgId,String(input.agentId)])).rows[0]?.n||0):0;
    return{ok:true,tickets:rows.map(r=>({...r,number:Number(r.number),id:Number(r.id)})),counts:{total:Number(counts.total||0),waiting:Number(counts.waiting||0),assigned:Number(counts.assigned||0),needsReply:Number(counts.needs_reply||0),solved:Number(counts.solved||0),closed:Number(counts.closed||0)},capacity:{active,max,remaining:Math.max(0,max-active)},page:{limit,offset,hasMore,nextCursor:null}};
  });
}

// Lightweight notification feed over independent chat messages.
export async function agentReplyAlerts(pool,orgId,input={}){
 return withOrg(pool,orgId,async c=>{
  if(input.initialize===true){const row=(await c.query("select coalesce(max(id),0)::text cursor from chat_messages where org_id=$1 and kind='requester'",[orgId])).rows[0];return{ok:true,cursor:String(row?.cursor||'0'),replies:[],hasMore:false};}
  const after=/^\\d{1,18}$/.test(String(input.after||''))?String(input.after):'0';
  const rows=(await c.query("select cm.id,cc.id as number,cc.requester_name,cc.requester_email,cc.updated_at,cc.status from chat_messages cm join chat_conversations cc on cc.org_id=cm.org_id and cc.id=cm.conversation_id where cm.org_id=$1 and cm.id>$2::bigint and cm.kind='requester' order by cm.id asc limit 101",[orgId,after])).rows;
  const more=rows.length>100,page=rows.slice(0,100),cursor=page.length?String(page[page.length-1].id):after;
  return{ok:true,cursor,hasMore:more,replies:page.filter(x=>['open','pending','on_hold'].includes(x.status)).map(x=>({number:Number(x.number),requester_name:x.requester_name,requester_email:x.requester_email,updated_at:x.updated_at}))};
 });
}

export async function startChat(pool,env,slug,input,mailer,provenance={}){
 const x=await liveOrg(pool,slug);if(!x)return fail('Chat is not available.',404);
 const name=clean(input.name,100),email=clean(input.email,254).toLowerCase(),body=clean(input.message,2000);
 if(!isEmail(email))return fail('Enter your email address so we can reach you if you leave.');if(!body)return fail('Write your message.');
 const visitorId=clean(input.visitorId,64),visitorKey=/^[a-f0-9]{64}$/i.test(visitorId)?crypto.createHash('sha256').update(x.org.id+':'+visitorId.toLowerCase()).digest('hex'):null;
 const reuseDays=Number(x.settings.reuse_days??DEFAULTS.reuse_days),cooldown=Math.max(0,Math.min(3600,Number(x.settings.restart_cooldown_seconds??15)));
 const result=await withOrg(pool,x.org.id,async c=>{
  if(visitorKey)await c.query('select pg_advisory_xact_lock(hashtext($1),hashtext($2))',[x.org.id,visitorKey]);
  if(cooldown>0){const ended=(await c.query("select greatest(1,ceil(extract(epoch from (e.created_at+($4::int*interval '1 second')-now())))::int) retry_after from chat_events e join chat_conversations cc on cc.org_id=e.org_id and cc.id=e.conversation_id where e.org_id=$1 and e.kind='visitor_ended' and lower(cc.requester_email)=lower($3) and e.created_at>now()-($4::int*interval '1 second') and ($2::text is null or cc.visitor_key=$2) order by e.created_at desc limit 1",[x.org.id,visitorKey,email,cooldown])).rows[0];if(ended)return{ok:false,status:429,error:'Please wait '+ended.retry_after+' seconds before starting another chat.',retryAfterSeconds:Number(ended.retry_after)};}
  let existing=null;if(visitorKey&&reuseDays>0)existing=(await c.query("select id from chat_conversations where org_id=$1 and visitor_key=$2 and lower(requester_email)=lower($3) and updated_at>=now()-($4::int*interval '1 day') and status in ('open','pending','on_hold') order by updated_at desc,id desc limit 1 for update",[x.org.id,visitorKey,email,reuseDays])).rows[0]||null;
  let id;if(existing){id=existing.id;await c.query("update chat_conversations set status='open',closed_at=null,solved_at=null,updated_at=now(),last_visitor_seen_at=now() where org_id=$1 and id=$2",[x.org.id,id]);}
  else{id=(await c.query(`insert into chat_conversations(org_id,subject,requester_name,requester_email,visitor_key,priority,page_url,page_title,referrer,user_agent,ip_address,source,last_visitor_seen_at)
    values($1,$2,$3,$4,$5,'normal',$6,$7,$8,$9,$10,'widget',now()) returning id`,
    [x.org.id,'Chat: '+body.replace(/\\s+/g,' ').slice(0,60),name,email,visitorKey,clean(provenance.pageUrl,2048)||null,clean(provenance.pageTitle,200)||null,clean(provenance.referrer,2048)||null,clean(provenance.userAgent,500)||null,clean(provenance.ip,64)||null])).rows[0].id;}
  await c.query("insert into chat_messages(org_id,conversation_id,kind,author_name,body) values($1,$2,'requester',$3,$4)",[x.org.id,id,name||email,body]);
  await c.query("update chat_conversations set visitor_token_hash=$3,updated_at=now(),last_visitor_seen_at=now() where org_id=$1 and id=$2",[x.org.id,id,crypto.createHash('sha256').update(chatToken(env,x.org.id,id)).digest('hex')]);
  await c.query("insert into chat_events(org_id,conversation_id,actor_name,kind,detail) values($1,$2,$3,$4,$5)",[x.org.id,id,name||email,existing?'visitor_returned':'visitor_started',existing?'Visitor returned to the conversation':'Visitor started a Live Chat conversation']);
  return{ok:true,number:Number(id),reused:!!existing};
 });
 if(!result.ok)return result;
 await emit(pool,x.org.id,'message.customer',result.number,{message:{body}});
 if(x.settings.auto_convert_to_ticket===true){const converted=await convertChatToTicket(pool,x.org.id,null,result.number);if(converted.ok)result.ticketNumber=converted.number;else logWarn('live_chat.auto_conversion_failed',{org:x.org.id,conversation:result.number,error:converted.error});}
 return{ok:true,number:result.number,token:chatToken(env,x.org.id,result.number),reused:result.reused===true,orgId:x.org.id,...(result.ticketNumber?{ticketNumber:result.ticketNumber}:{})};
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
export async function updateChatContext(pool, env, slug, input) {
  const x = await liveOrg(pool, slug); if (!x) return fail('Chat is not available.', 404);
  const number = Number(input.number) || 0;
  if (!tokenOk(env, x.org.id, number, input.token)) return fail('This chat is not yours.', 403);
  const pageUrl = clean(input.pageUrl, 2048), pageTitle = clean(input.pageTitle, 200);
  const hasLatitude = input.latitude !== undefined && input.latitude !== null && input.latitude !== '';
  const hasLongitude = input.longitude !== undefined && input.longitude !== null && input.longitude !== '';
  if (hasLatitude !== hasLongitude) return fail('Share both location coordinates together.');
  let latitude = null, longitude = null;
  if (hasLatitude) {
    latitude = Number(input.latitude); longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return fail('The shared location is not valid.');
    // Store a coarse position (~1 km), not the browser's full-precision coordinates.
    latitude = Math.round(latitude * 100) / 100; longitude = Math.round(longitude * 100) / 100;
  }
  let parsed;
  try { parsed = new URL(pageUrl); } catch { return fail('A valid page URL is required.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return fail('A valid page URL is required.');
  parsed.search = ''; parsed.hash = '';
  return withOrg(pool, x.org.id, async c => {
    const t = (await c.query("select id,status,channel from tickets where org_id=$1 and number=$2 for update", [x.org.id, number])).rows[0];
    if (!t || t.channel !== 'chat') return fail('No such chat.', 404);
    if (['closed','solved'].includes(t.status)) return fail('This chat has ended.', 409);
    await c.query(`update ticket_provenance set page_url=$3,page_title=$4,
      latitude=case when $5::boolean then $6::double precision else latitude end,
      longitude=case when $5::boolean then $7::double precision else longitude end,
      submitted_at=now() where org_id=$1 and ticket_id=$2`, [x.org.id, t.id, parsed.href.slice(0,2048), pageTitle || null, hasLatitude, latitude, longitude]);
    return { ok: true };
  });
}
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
    if (act === 'context') { if (await tooMany(pool, 'cx' + ip, now, 30)) return json(429, { error: 'Slow down.' }); const r = await updateChatContext(pool, env, slug, b); return json(r.ok ? 200 : r.status, r); }
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
