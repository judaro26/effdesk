// src/routing.js: AUTOMATIC ASSIGNMENT. When it is switched on, a ticket that a customer starts (web form, email, chat, API) goes to a full agent at once:
//   round robin = the agent who was given a ticket longest ago; least busy = the agent with the fewest open tickets. Agents who marked themselves away, light agents, and agents at the open-ticket limit are skipped.
//   If nobody is eligible the ticket stays unassigned, as before.
import { withOrg } from './db.js';
const fail = (error, status = 400) => ({ ok: false, status, error });
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
    const row = (await c.query('select chat_access, chat_available from agent_status where org_id = $1 and user_id = $2', [orgId, userId])).rows[0] || {};
    return { access: row.chat_access === true, available: row.chat_available === true };
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
    const r = await c.query('update agent_status set chat_available = $3 where org_id = $1 and user_id = $2 and chat_access = true returning chat_available', [orgId, userId, available === true]);
    if (!r.rowCount) return fail('An admin must enable Live Chat access for you first.', 403);
    return { ok: true, available: r.rows[0].chat_available };
  });
}

export async function chatCapacityForAgent(c, orgId, userId) {
  const row = (await c.query("select " +
    "(select max_concurrent from chat_capacity_rules where org_id=$1 and scope_type='agent' and scope_id=$2) as agent_limit, " +
    "(select cr.max_concurrent from chat_team_members tm join chat_capacity_rules cr on cr.org_id=tm.org_id and cr.scope_type='team' and cr.scope_id=tm.team_id::text where tm.org_id=$1 and tm.user_id=$2 limit 1) as team_limit, " +
    "(select cr.max_concurrent from member m left join member_custom_role mc on mc.org_id=$1 and mc.user_id=m.\"userId\" join chat_capacity_rules cr on cr.org_id=$1 and cr.scope_type='role' and cr.scope_id=case when mc.role_id is null then m.role else 'custom:' || mc.role_id::text end where m.\"organizationId\"=$1 and m.\"userId\"=$2 limit 1) as role_limit, " +
    "(select max_concurrent from chat_settings where org_id=$1) as workspace_limit", [orgId, String(userId)])).rows[0] || {};
  return Math.max(1, Math.min(10, Number(row.agent_limit ?? row.team_limit ?? row.role_limit ?? row.workspace_limit ?? 3) || 3));
}

export async function getChatCapacityConfig(pool, orgId) {
  return withOrg(pool, orgId, async c => {
    const [teams, agents, customRoles, rules, settings] = await Promise.all([
      c.query("select ct.id, ct.name, count(tm.user_id)::int as member_count from chat_teams ct left join chat_team_members tm on tm.org_id=ct.org_id and tm.team_id=ct.id where ct.org_id=$1 group by ct.id order by lower(ct.name), ct.id", [orgId]),
      c.query("select m.\"userId\" as user_id, u.name, u.email, m.role, mc.role_id, cr.name as custom_role, tm.team_id, ct.name as team_name from member m join \"user\" u on u.id=m.\"userId\" left join member_custom_role mc on mc.org_id=$1 and mc.user_id=m.\"userId\" left join custom_roles cr on cr.org_id=$1 and cr.id=mc.role_id left join chat_team_members tm on tm.org_id=$1 and tm.user_id=m.\"userId\" left join chat_teams ct on ct.org_id=tm.org_id and ct.id=tm.team_id where m.\"organizationId\"=$1 and m.role in ('owner','admin','member') order by lower(coalesce(u.name,u.email)), m.\"userId\"", [orgId]),
      c.query('select id, name from custom_roles where org_id=$1 order by lower(name), id', [orgId]),
      c.query('select scope_type, scope_id, max_concurrent from chat_capacity_rules where org_id=$1 order by scope_type, scope_id', [orgId]),
      c.query('select max_concurrent from chat_settings where org_id=$1', [orgId])
    ]);
    return { ok: true, defaultMaxConcurrent: Number(settings.rows[0]?.max_concurrent || 3), teams: teams.rows, agents: agents.rows, roles: [
      { scope_id: 'owner', name: 'Owner' }, { scope_id: 'admin', name: 'Admin' }, { scope_id: 'member', name: 'Agent' },
      ...customRoles.rows.map(x => ({ scope_id: 'custom:' + x.id, name: x.name + ' (custom role)' }))
    ], rules: rules.rows };
  });
}

export async function saveChatCapacityRule(pool, orgId, input = {}) {
  const scopeType = ['agent','role','team'].includes(input.scopeType) ? input.scopeType : '';
  const scopeId = String(input.scopeId || '').trim().slice(0, 120);
  const raw = input.maxConcurrent;
  const remove = raw === null || raw === undefined || raw === '';
  const maxConcurrent = remove ? null : Number(raw);
  if (!scopeType || !scopeId) return fail('Choose a valid capacity scope.');
  if (!remove && (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 10)) return fail('The simultaneous-chat limit must be a whole number from 1 to 10.');
  return withOrg(pool, orgId, async c => {
    if (scopeType === 'agent') {
      const exists = await c.query("select 1 from member where \"organizationId\"=$1 and \"userId\"=$2 and role in ('owner','admin','member')", [orgId, scopeId]);
      if (!exists.rowCount) return fail('Choose an eligible agent in this workspace.', 404);
    } else if (scopeType === 'team') {
      const exists = await c.query('select 1 from chat_teams where org_id=$1 and id::text=$2', [orgId, scopeId]);
      if (!exists.rowCount) return fail('Choose a Live Chat team in this workspace.', 404);
    } else {
      const custom = /^custom:(\d+)$/.exec(scopeId);
      if (!['owner','admin','member'].includes(scopeId) && !custom) return fail('Choose a valid workspace role.');
      if (custom && !(await c.query('select 1 from custom_roles where org_id=$1 and id=$2', [orgId, custom[1]])).rowCount) return fail('Choose a custom role in this workspace.', 404);
    }
    if (remove) await c.query('delete from chat_capacity_rules where org_id=$1 and scope_type=$2 and scope_id=$3', [orgId, scopeType, scopeId]);
    else await c.query("insert into chat_capacity_rules (org_id,scope_type,scope_id,max_concurrent) values ($1,$2,$3,$4) on conflict (org_id,scope_type,scope_id) do update set max_concurrent=$4, updated_at=now()", [orgId, scopeType, scopeId, maxConcurrent]);
    return { ok: true, scopeType, scopeId, maxConcurrent };
  });
}

export async function saveChatTeam(pool, orgId, input = {}) {
  const name = String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const members = Array.isArray(input.memberIds) ? [...new Set(input.memberIds.map(x => String(x || '').trim()).filter(Boolean))].slice(0, 200) : [];
  const id = input.id == null || input.id === '' ? null : Number(input.id);
  if (!name) return fail('Enter a team name.');
  if (id !== null && (!Number.isSafeInteger(id) || id < 1)) return fail('Choose a valid team.');
  return withOrg(pool, orgId, async c => {
    let teamId;
    if (id === null) {
      const row = (await c.query('insert into chat_teams (org_id,name) values ($1,$2) returning id', [orgId,name])).rows[0];
      teamId = row.id;
    } else {
      const row = (await c.query('update chat_teams set name=$3, updated_at=now() where org_id=$1 and id=$2 returning id', [orgId,id,name])).rows[0];
      if (!row) return fail('No such Live Chat team.', 404);
      teamId = row.id;
    }
    if (members.length) {
      const eligible = await c.query("select \"userId\" from member where \"organizationId\"=$1 and \"userId\"=any($2::text[]) and role in ('owner','admin','member')", [orgId,members]);
      if (eligible.rowCount !== members.length) return fail('Every team member must be an eligible agent in this workspace.');
    }
    await c.query('delete from chat_team_members where org_id=$1 and (team_id=$2 or user_id=any($3::text[]))', [orgId,teamId,members]);
    for (const userId of members) await c.query('insert into chat_team_members (org_id,team_id,user_id) values ($1,$2,$3)', [orgId,teamId,userId]);
    return { ok: true, team: { id: Number(teamId), name, memberIds: members } };
  });
}

export async function deleteChatTeam(pool, orgId, teamId) {
  const id = Number(teamId);
  if (!Number.isSafeInteger(id) || id < 1) return fail('Choose a valid Live Chat team.');
  return withOrg(pool, orgId, async c => {
    const row = await c.query('delete from chat_teams where org_id=$1 and id=$2 returning id', [orgId,id]);
    if (!row.rowCount) return fail('No such Live Chat team.', 404);
    await c.query("delete from chat_capacity_rules where org_id=$1 and scope_type='team' and scope_id=$2", [orgId,String(id)]);
    return { ok: true };
  });
}

// inside the ticket's transaction: choose, record, return { id, name } or null
export async function autoAssign(c, orgId, ticketId) {
  const s = (await c.query('select enabled, strategy, max_open from routing_settings where org_id = $1', [orgId])).rows[0]; if (!s || !s.enabled) return null;
  const channel = (await c.query('select channel from tickets where org_id = $1 and id = $2', [orgId, ticketId])).rows[0]?.channel;
  const rows = (await c.query(`select m."userId" as id, u.name, u.email, coalesce(a.available, true) as available,
      coalesce(a.chat_access, false) as chat_access, coalesce(a.chat_available, false) as chat_available, a.last_assigned_at,
      (select count(*)::int from tickets t where t.org_id = $1 and t.assignee_id = m."userId" and t.status in ('open','pending','on_hold')) as open
    from member m join "user" u on u.id = m."userId" left join agent_status a on a.org_id = $1 and a.user_id = m."userId"
    where m."organizationId" = $1 and m.role in ('owner','admin','member')`, [orgId])).rows;
  const ok = rows.filter(r => (channel === 'chat' ? (r.chat_access && r.chat_available) : r.available) && (!s.max_open || r.open < s.max_open)); if (!ok.length) return null;
  const last = r => r.last_assigned_at ? new Date(r.last_assigned_at).getTime() : 0;
  ok.sort(s.strategy === 'least_busy' ? (a, b) => a.open - b.open || last(a) - last(b) || (a.id < b.id ? -1 : 1) : (a, b) => last(a) - last(b) || a.open - b.open || (a.id < b.id ? -1 : 1));
  for (const pick of ok) {
    if (channel === 'chat') {
      await c.query('select user_id from agent_status where org_id = $1 and user_id = $2 for update', [orgId, pick.id]);
      const maxChats = await chatCapacityForAgent(c, orgId, pick.id);
      const active = Number((await c.query("select count(*)::int as n from tickets where org_id = $1 and channel = 'chat' and assignee_id = $2 and status in ('open','pending','on_hold')", [orgId, pick.id])).rows[0]?.n || 0);
      if (active >= maxChats) continue;
    }
    await c.query('update tickets set assignee_id = $3 where org_id = $1 and id = $2', [orgId, ticketId, pick.id]);
    await c.query('insert into agent_status (org_id, user_id, last_assigned_at) values ($1,$2,now()) on conflict (org_id, user_id) do update set last_assigned_at = now()', [orgId, pick.id]);
    return { id: pick.id, name: pick.name || pick.email };
  }
  return null;
}

// Atomically claim an unassigned chat. The membership and agent-status row locks serialize
// concurrent claims by the same agent; the ticket row lock makes competing claims single-winner.
export async function claimChat(pool, orgId, userId, number) {
  return withOrg(pool, orgId, async c => {
    const member = (await c.query('select m.role, u.name, u.email from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 and m."userId" = $2 for update of m', [orgId, userId])).rows[0];
    if (!member || member.role === 'light') return fail('You are not allowed to accept live chats.', 403);
    const agent = (await c.query('select chat_access, chat_available from agent_status where org_id = $1 and user_id = $2 for update', [orgId, userId])).rows[0];
    if (!agent || agent.chat_access !== true) return fail('An admin must enable Live Chat access for you first.', 403);
    if (agent.chat_available !== true) return fail('Switch on Accept live chats before claiming a conversation.', 409);
    const ticket = (await c.query("select id, status, assignee_id from tickets where org_id = $1 and number = $2 and channel = 'chat' for update", [orgId, Number(number) || 0])).rows[0];
    if (!ticket) return fail('No such live chat.', 404);
    if (ticket.status === 'closed' || ticket.status === 'solved') return fail('This chat has ended.', 409);
    if (ticket.assignee_id) return ticket.assignee_id === userId ? { ok: true, alreadyAssigned: true } : fail('Another agent has already accepted this chat.', 409);
    const maxConcurrent = await chatCapacityForAgent(c, orgId, userId);
    const active = Number((await c.query("select count(*)::int as n from tickets where org_id = $1 and channel = 'chat' and assignee_id = $2 and status in ('open','pending','on_hold')", [orgId, userId])).rows[0]?.n || 0);
    if (active >= maxConcurrent) return fail('You have reached your maximum of ' + maxConcurrent + ' simultaneous chats.', 409);
    await c.query('update tickets set assignee_id = $3, updated_at = now() where org_id = $1 and id = $2', [orgId, ticket.id, userId]);
    await c.query("insert into ticket_events (org_id, ticket_id, actor_name, kind, detail) values ($1,$2,$3,'assigned','Accepted live chat')", [orgId, ticket.id, member.name || member.email]);
    await c.query('update agent_status set last_assigned_at = now() where org_id = $1 and user_id = $2', [orgId, userId]);
    return { ok: true, alreadyAssigned: false, activeChats: active + 1, maxConcurrent };
  });
}
