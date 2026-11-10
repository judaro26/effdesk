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
// inside the ticket's transaction: choose, record, return { id, name } or null
export async function autoAssign(c, orgId, ticketId) {
  const s = (await c.query('select enabled, strategy, max_open from routing_settings where org_id = $1', [orgId])).rows[0]; if (!s || !s.enabled) return null;
  const rows = (await c.query(`select m."userId" as id, u.name, u.email, coalesce(a.available, true) as available, a.last_assigned_at,
      (select count(*)::int from tickets t where t.org_id = $1 and t.assignee_id = m."userId" and t.status in ('open','pending')) as open
    from member m join "user" u on u.id = m."userId" left join agent_status a on a.org_id = $1 and a.user_id = m."userId"
    where m."organizationId" = $1 and m.role in ('owner','admin','member')`, [orgId])).rows;
  const ok = rows.filter(r => r.available && (!s.max_open || r.open < s.max_open)); if (!ok.length) return null;
  const last = r => r.last_assigned_at ? new Date(r.last_assigned_at).getTime() : 0;
  ok.sort(s.strategy === 'least_busy' ? (a, b) => a.open - b.open || last(a) - last(b) || (a.id < b.id ? -1 : 1) : (a, b) => last(a) - last(b) || a.open - b.open || (a.id < b.id ? -1 : 1));
  const pick = ok[0];
  await c.query('update tickets set assignee_id = $3 where org_id = $1 and id = $2', [orgId, ticketId, pick.id]);
  await c.query('insert into agent_status (org_id, user_id, last_assigned_at) values ($1,$2,now()) on conflict (org_id, user_id) do update set last_assigned_at = now()', [orgId, pick.id]);
  return { id: pick.id, name: pick.name || pick.email };
}
