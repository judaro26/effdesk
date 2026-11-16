// src/routing.js: AUTOMATIC ASSIGNMENT. When it is switched on, a ticket that a customer starts (web form, email, chat, API) goes to a full agent at once:
//   round robin = the agent who was given a ticket longest ago; least busy = the agent with the fewest open tickets. Agents who marked themselves away, light agents, and agents at the open-ticket limit are skipped.
//   If nobody is eligible the ticket stays unassigned, as before.
import { withOrg } from './db.js';
const clean = (value, max) => String(value == null ? '' : value).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400) => ({ ok: false, status, error });
export const CHAT_HEARTBEAT_TTL_SECONDS = 180;
export const STRATEGIES = ['round_robin', 'least_busy'];
export async function getRouting(pool, orgId) {
  return withOrg(pool, orgId, async c => { const r = (await c.query('select enabled, strategy, max_open from routing_settings where org_id = $1', [orgId])).rows[0]; return { enabled: false, strategy: 'round_robin', max_open: null, ...(r || {}) }; });
}
export async function saveRouting(pool, orgId, b) {
  const strategy = STRATEGIES.includes(b.strategy) ? b.strategy : 'round_robin', maxOpen = b.maxOpen === '' || b.maxOpen == null ? null : Number(b.maxOpen);
  if (maxOpen !== null && (!Number.isInteger(maxOpen) || maxOpen < 1 || maxOpen > 500)) return fail('The limit is a whole number from 1 to 500, or empty for no limit.');
  await withOrg(pool, orgId, c => c.query('insert into routing_settings (org_id, enabled, strategy, max_open) values ($1,$2,$3,$4) on conflict (org_id) do update set enabled = $2, strategy = $3, max_open = $4, updated_at = now()', [orgId, b.enabled === true, strategy, maxOpen]));
  return { ok: true, settings: { enabled: b.enabled === true, strategy, max_open: maxOpen } };
}
export async function setAvailable(pool, orgId, userId, available) {
  await withOrg(pool, orgId, c => c.query('insert into agent_status (org_id, user_id, available) values ($1,$2,$3) on conflict (org_id, user_id) do update set available = $3', [orgId, userId, available !== false]));
  return { ok: true, available: available !== false };
}
export async function myAvailability(pool, orgId, userId) { return withOrg(pool, orgId, async c => ((await c.query('select available from agent_status where org_id = $1 and user_id = $2', [orgId, userId])).rows[0] || { available: true }).available); }

// Live Chat access is an administrator-controlled entitlement per teammate. Access and
// the agent's own availability are separate: granting access never silently puts them online.
export async function getChatAvailability(pool, orgId, userId) {
  return withOrg(pool, orgId, async c => {
    const row = (await c.query("select chat_access, chat_available, chat_last_seen_at > now() - interval '3 minutes' as recently_seen from agent_status where org_id = $1 and user_id = $2", [orgId, userId])).rows[0] || {};
    return { access: row.chat_access === true, available: row.chat_available === true && row.recently_seen === true };
  });
}
export async function setChatAccess(pool, orgId, userId, enabled) {
  return withOrg(pool, orgId, async c => {
    // Lock the membership row so a concurrent role change/removal cannot race an access grant.
    const member = (await c.query(`select m.role, r.permissions from member m
      left join member_custom_role mc on mc.org_id = $1 and mc.user_id = m."userId"
      left join custom_roles r on r.org_id = $1 and r.id = mc.role_id
      where m."organizationId" = $1 and m."userId" = $2 for update of m`, [orgId, String(userId || '')])).rows[0];
    if (!member) return fail('Choose a teammate in this workspace.', 404);
    if (enabled && member.role === 'light') return fail('Light agents cannot handle live chats. Change their role first.');
    if (enabled && member.role === 'member' && Array.isArray(member.permissions) && !member.permissions.includes('reply')) return fail('This agent’s custom role does not allow customer replies. Add the reply permission first.');
    await c.query(`insert into agent_status (org_id, user_id, available, chat_access, chat_available)
      values ($1,$2,true,$3,false)
      on conflict (org_id, user_id) do update set chat_access = $3, chat_available = false`, [orgId, String(userId), enabled === true]);
    if (!enabled) await c.query("update tickets set assignee_id = null, updated_at = now() where org_id = $1 and assignee_id = $2 and channel = 'chat' and status in ('open','pending','on_hold')", [orgId, String(userId)]);
    return { ok: true, access: enabled === true, available: false };
  });
}
export async function setChatAvailable(pool, orgId, userId, available) {
  return withOrg(pool, orgId, async c => {
    const member = (await c.query('select role from member where "organizationId" = $1 and "userId" = $2 for update', [orgId, userId])).rows[0];
    if (!member || member.role === 'light') return fail('You are not allowed to accept live chats.', 403);
    const r = await c.query('update agent_status set chat_available = $3, chat_last_seen_at = case when $3 then now() else null end where org_id = $1 and user_id = $2 and chat_access = true returning chat_available', [orgId, userId, available === true]);
    if (!r.rowCount) return fail('An admin must enable Live Chat access for you first.', 403);
    return { ok: true, available: r.rows[0].chat_available };
  });
}
// inside the ticket's transaction: choose, record, return { id, name } or null
export async function autoAssign(c, orgId, ticketId) {
  const s = (await c.query('select enabled, strategy, max_open from routing_settings where org_id = $1', [orgId])).rows[0]; if (!s || !s.enabled) return null;
  const channel = (await c.query('select channel from tickets where org_id = $1 and id = $2', [orgId, ticketId])).rows[0]?.channel;
  const rows = (await c.query(`select m."userId" as id, u.name, u.email, coalesce(a.available, true) as available,
      coalesce(a.chat_access, false) as chat_access, coalesce(a.chat_available, false) as chat_available, a.chat_last_seen_at, a.last_assigned_at,
      (select count(*)::int from tickets t where t.org_id = $1 and t.assignee_id = m."userId" and t.status in ('open','pending','on_hold')) as open
    from member m join "user" u on u.id = m."userId" left join agent_status a on a.org_id = $1 and a.user_id = m."userId"
    where m."organizationId" = $1 and m.role in ('owner','admin','member')`, [orgId])).rows;
  const ok = rows.filter(r => (channel === 'chat' ? (r.chat_access && r.chat_available && r.chat_last_seen_at && new Date(r.chat_last_seen_at).getTime() > Date.now() - CHAT_HEARTBEAT_TTL_SECONDS * 1000) : r.available) && (!s.max_open || r.open < s.max_open)); if (!ok.length) return null;
  const last = r => r.last_assigned_at ? new Date(r.last_assigned_at).getTime() : 0;
  ok.sort(s.strategy === 'least_busy' ? (a, b) => a.open - b.open || last(a) - last(b) || (a.id < b.id ? -1 : 1) : (a, b) => last(a) - last(b) || a.open - b.open || (a.id < b.id ? -1 : 1));
  const maxChats = channel === 'chat' ? Math.max(1, Math.min(10, Number((await c.query('select max_concurrent from chat_settings where org_id = $1', [orgId])).rows[0]?.max_concurrent) || 3)) : null;
  for (const pick of ok) {
    if (channel === 'chat') {
      await c.query('select user_id from agent_status where org_id = $1 and user_id = $2 for update', [orgId, pick.id]);
      const active = Number((await c.query("select count(*)::int as n from tickets where org_id = $1 and channel = 'chat' and assignee_id = $2 and status in ('open','pending','on_hold')", [orgId, pick.id])).rows[0]?.n || 0);
      if (active >= maxChats) continue;
    }
    await c.query('update tickets set assignee_id = $3 where org_id = $1 and id = $2', [orgId, ticketId, pick.id]);
    await c.query('insert into agent_status (org_id, user_id, last_assigned_at) values ($1,$2,now()) on conflict (org_id, user_id) do update set last_assigned_at = now()', [orgId, pick.id]);
    return { id: pick.id, name: pick.name || pick.email };
  }
  return null;
}


export async function heartbeatChat(pool, orgId, userId) {
  return withOrg(pool, orgId, async c => {
    const r = await c.query("update agent_status set chat_last_seen_at=now() where org_id=$1 and user_id=$2 and chat_access=true and chat_available=true returning chat_last_seen_at", [orgId,userId]);
    return { ok:true, accepting: r.rowCount === 1, lastSeenAt: r.rows[0]?.chat_last_seen_at || null };
  });
}
export async function getChatTeam(pool, orgId) {
  return withOrg(pool, orgId, async c => {
    const maxConcurrent = Math.max(1, Math.min(10, Number((await c.query('select max_concurrent from chat_settings where org_id=$1',[orgId])).rows[0]?.max_concurrent) || 3));
    const rows = (await c.query(`select m."userId" as user_id, u.name, u.email, m.role, r.permissions, a.chat_available,
      (a.chat_last_seen_at > now() - interval '3 minutes') as recently_seen,
      (select count(*)::int from tickets t where t.org_id=$1 and t.channel='chat' and t.assignee_id=m."userId" and t.status in ('open','pending','on_hold')) as active_chats
      from member m join "user" u on u.id=m."userId" join agent_status a on a.org_id=$1 and a.user_id=m."userId"
      left join member_custom_role mc on mc.org_id=$1 and mc.user_id=m."userId"
      left join custom_roles r on r.org_id=$1 and r.id=mc.role_id
      where m."organizationId"=$1 and m.role in ('owner','admin','member') and a.chat_access=true
      order by (a.chat_available and a.chat_last_seen_at > now() - interval '3 minutes') desc, active_chats asc, u.name asc`,[orgId])).rows;
    return { ok:true, maxConcurrent, agents: rows.map(a => {
      const activeChats=Number(a.active_chats||0), online=a.chat_available===true && a.recently_seen===true;
      const replyAllowed=a.role!=='member' || !Array.isArray(a.permissions) || a.permissions.includes('reply');
      return { user_id:a.user_id, name:a.name||a.email, email:a.email, online, active_chats:activeChats, max_concurrent:maxConcurrent, remaining:Math.max(0,maxConcurrent-activeChats), eligible:online && activeChats<maxConcurrent && replyAllowed };
    }) };
  });
}
export async function transferChat(pool, orgId, actor, number, targetUserId, canManage=false) {
  return withOrg(pool, orgId, async c => {
    const targetId=String(targetUserId||'').slice(0,128);
    if(!targetId)return fail('Choose a teammate to receive this conversation.');
    // Lock order matches claimChat: membership, agent status, then ticket.
    const member=(await c.query(`select m.role,r.permissions,u.name,u.email from member m join "user" u on u.id=m."userId"
      left join member_custom_role mc on mc.org_id=$1 and mc.user_id=m."userId"
      left join custom_roles r on r.org_id=$1 and r.id=mc.role_id
      where m."organizationId"=$1 and m."userId"=$2 for update of m`,[orgId,targetId])).rows[0];
    if(!member || member.role==='light' || (member.role==='member' && Array.isArray(member.permissions) && !member.permissions.includes('reply')))return fail('That teammate is not permitted to handle customer chats.',403);
    const agent=(await c.query('select chat_access,chat_available,chat_last_seen_at from agent_status where org_id=$1 and user_id=$2 for update',[orgId,targetId])).rows[0];
    if(!agent || agent.chat_access!==true)return fail('Enable Live Chat access for that teammate first.',409);
    if(agent.chat_available!==true || !agent.chat_last_seen_at || new Date(agent.chat_last_seen_at).getTime()<=Date.now()-CHAT_HEARTBEAT_TTL_SECONDS*1000)return fail('That teammate is not currently available for Live Chat.',409);
    const ticket=(await c.query("select id,number,status,assignee_id from tickets where org_id=$1 and number=$2 and channel='chat' for update",[orgId,Number(number)||0])).rows[0];
    if(!ticket)return fail('Live Chat conversation not found.',404);
    if(!['open','pending','on_hold'].includes(ticket.status))return fail('This conversation has already ended.',409);
    if(ticket.assignee_id && ticket.assignee_id!==actor.id && !canManage)return fail('Only the assigned agent or an administrator can transfer this conversation.',403);
    if(!ticket.assignee_id && !canManage)return fail('An administrator must assign this conversation before it can be transferred.',403);
    if(ticket.assignee_id===targetId)return {ok:true,alreadyAssigned:true,userId:targetId};
    const maxConcurrent=Math.max(1,Math.min(10,Number((await c.query('select max_concurrent from chat_settings where org_id=$1',[orgId])).rows[0]?.max_concurrent)||3));
    const activeChats=Number((await c.query("select count(*)::int n from tickets where org_id=$1 and channel='chat' and assignee_id=$2 and status in ('open','pending','on_hold')",[orgId,targetId])).rows[0]?.n||0);
    if(activeChats>=maxConcurrent)return fail('That teammate has reached their simultaneous-chat limit.',409);
    await c.query('update tickets set assignee_id=$3,updated_at=now() where org_id=$1 and id=$2',[orgId,ticket.id,targetId]);
    const actorName=actor?.name||actor?.email||'Agent';
    await c.query("insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,'assigned',$4)",[orgId,ticket.id,actorName,'Transferred Live Chat to '+(member.name||member.email)]);
    return {ok:true,alreadyAssigned:false,userId:targetId,agentName:member.name||member.email,activeChats:activeChats+1,maxConcurrent};
  });
}


/**
 * Supervisors can inspect a live conversation without changing its assignee.
 * Keep the payload intentionally narrow: conversation metadata, transcript and
 * visitor page context only; no attachment bytes or unrelated ticket extras.
 */
export async function monitorChat(pool, orgId, number) {
  return withOrg(pool, orgId, async c => {
    const ticket = (await c.query(`select id, number, subject, status, priority, assignee_id, requester_name,
      requester_email, created_at, updated_at, channel
      from tickets where org_id=$1 and number=$2 and channel='chat'`, [orgId, Number(number)||0])).rows[0];
    if (!ticket) return fail('Live Chat conversation not found.', 404);
    if (!['open','pending','on_hold'].includes(ticket.status)) return fail('This conversation has ended.', 409);
    const messages = (await c.query(`select id, kind, author_id, author_name, body, html_body, created_at
      from ticket_messages where org_id=$1 and ticket_id=$2 order by created_at desc,id desc limit 100`, [orgId,ticket.id])).rows.reverse();
    const provenance = (await c.query('select page_url,page_title,submitted_at from ticket_provenance where org_id=$1 and ticket_id=$2',[orgId,ticket.id])).rows[0] || null;
    const assignee = ticket.assignee_id ? (await c.query('select u.id,u.name,u.email from member m join "user" u on u.id=m."userId" where m."organizationId"=$1 and m."userId"=$2',[orgId,ticket.assignee_id])).rows[0] || null : null;
    return {ok:true, ticket:{...ticket,assignee},messages,provenance,readOnly:true};
  });
}

/** Add a private coaching note to the conversation. It is never sent to the visitor. */
export async function copilotChat(pool, orgId, actor, number, body) {
  const note=clean(body,2000);
  if(!note)return fail('Write a coaching note first.');
  return withOrg(pool, orgId, async c => {
    const ticket=(await c.query("select id,status from tickets where org_id=$1 and number=$2 and channel='chat' for update",[orgId,Number(number)||0])).rows[0];
    if(!ticket)return fail('Live Chat conversation not found.',404);
    if(!['open','pending','on_hold'].includes(ticket.status))return fail('This conversation has ended.',409);
    const message=(await c.query("insert into ticket_messages (org_id,ticket_id,kind,author_id,author_name,body) values($1,$2,'note',$3,$4,$5) returning id,kind,author_id,author_name,body,created_at",[orgId,ticket.id,actor.id,clean(actor.name,100)||actor.email,note])).rows[0];
    await c.query("insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,'note','Private supervisor coaching added')",[orgId,ticket.id,clean(actor.name,100)||actor.email]);
    return {ok:true,message};
  });
}

/** A supervisor can take ownership immediately; no visitor transcript is rewritten. */
export async function takeoverChat(pool, orgId, actor, number) {
  return withOrg(pool, orgId, async c => {
    const member=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2 for update',[orgId,actor.id])).rows[0];
    if(!member || member.role==='light')return fail('You are not allowed to take over live chats.',403);
    const access=(await c.query('select chat_access from agent_status where org_id=$1 and user_id=$2 for update',[orgId,actor.id])).rows[0];
    if(!access || access.chat_access!==true)return fail('An admin must enable Live Chat access for you before taking over a conversation.',403);
    const ticket=(await c.query("select id,status,assignee_id from tickets where org_id=$1 and number=$2 and channel='chat' for update",[orgId,Number(number)||0])).rows[0];
    if(!ticket)return fail('Live Chat conversation not found.',404);
    if(!['open','pending','on_hold'].includes(ticket.status))return fail('This conversation has ended.',409);
    if(ticket.assignee_id===actor.id)return {ok:true,alreadyAssigned:true};
    await c.query('update tickets set assignee_id=$3,updated_at=now() where org_id=$1 and id=$2',[orgId,ticket.id,actor.id]);
    const actorName=clean(actor.name,100)||actor.email||'Supervisor';
    await c.query("insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,'assigned',$4)",[orgId,ticket.id,actorName,'Supervisor took over the live conversation']);
    return {ok:true,previousAssigneeId:ticket.assignee_id||null,assigneeId:actor.id};
  });
}

// Atomically claim an unassigned chat. The membership and agent-status row locks serialize
// concurrent claims by the same agent; the ticket row lock makes competing claims single-winner.
export async function claimChat(pool, orgId, userId, number) {
  return withOrg(pool, orgId, async c => {
    const member = (await c.query('select m.role, u.name, u.email from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 and m."userId" = $2 for update of m', [orgId, userId])).rows[0];
    if (!member || member.role === 'light') return fail('You are not allowed to accept live chats.', 403);
    const agent = (await c.query('select chat_access, chat_available, chat_last_seen_at from agent_status where org_id = $1 and user_id = $2 for update', [orgId, userId])).rows[0];
    if (!agent || agent.chat_access !== true) return fail('An admin must enable Live Chat access for you first.', 403);
    if (agent.chat_available !== true) return fail('Switch on Accept live chats before accepting a conversation.', 409);
    const ticket = (await c.query("select id, status, assignee_id from tickets where org_id = $1 and number = $2 and channel = 'chat' for update", [orgId, Number(number) || 0])).rows[0];
    if (!ticket) return fail('No such live chat.', 404);
    if (ticket.status === 'closed' || ticket.status === 'solved') return fail('This chat has ended.', 409);
    if (ticket.assignee_id) return ticket.assignee_id === userId ? { ok: true, alreadyAssigned: true } : fail('Another agent has already accepted this chat.', 409);
    // A manual Accept click is an explicit sign that the agent is active now. Refresh
    // an expired heartbeat here so a background-tab/browser sleep does not force an
    // unnecessary off/on cycle. Automatic routing still requires a fresh heartbeat.
    if (!agent.chat_last_seen_at || new Date(agent.chat_last_seen_at).getTime() <= Date.now() - CHAT_HEARTBEAT_TTL_SECONDS * 1000) {
      await c.query('update agent_status set chat_last_seen_at = now() where org_id = $1 and user_id = $2 and chat_access = true and chat_available = true', [orgId, userId]);
    }
    const configured = (await c.query('select max_concurrent from chat_settings where org_id = $1', [orgId])).rows[0];
    const maxConcurrent = Math.max(1, Math.min(10, Number(configured?.max_concurrent) || 3));
    const active = Number((await c.query("select count(*)::int as n from tickets where org_id = $1 and channel = 'chat' and assignee_id = $2 and status in ('open','pending','on_hold')", [orgId, userId])).rows[0]?.n || 0);
    if (active >= maxConcurrent) return fail('You have reached your maximum of ' + maxConcurrent + ' simultaneous chats.', 409);
    await c.query('update tickets set assignee_id = $3, updated_at = now() where org_id = $1 and id = $2', [orgId, ticket.id, userId]);
    await c.query("insert into ticket_events (org_id, ticket_id, actor_name, kind, detail) values ($1,$2,$3,'assigned','Accepted live chat')", [orgId, ticket.id, member.name || member.email]);
    await c.query('update agent_status set last_assigned_at = now() where org_id = $1 and user_id = $2', [orgId, userId]);
    return { ok: true, alreadyAssigned: false, activeChats: active + 1, maxConcurrent };
  });
}
