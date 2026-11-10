// src/team.js: THE TEAM OF ONE ORGANIZATION, for its owners and admins: who is in, their role, when they were last active, how many tickets they own, pending invitations, and the seats used.
//   Rules: only an owner can make or change an owner; an organization always keeps at least one owner; you cannot remove or demote yourself here; removing someone hands their open tickets to a teammate (or to nobody).
import { withOrg } from './db.js';
import { seatsUsed } from './billing.js';
import { PRODUCT } from './config.js';
export const ROLES = ['owner', 'admin', 'member', 'light'];          // light: free, can read tickets and add internal notes (no replies, no changes); not counted as a seat
const fail = (error, status = 400) => ({ ok: false, status, error });
export async function listTeam(pool, orgId, ent) {
  const people = (await pool.query(`select m.id as member_id, u.id as user_id, u.name, u.email, m.role, m."createdAt" as joined,
      (select max(s."updatedAt") from session s where s."userId" = u.id) as last_active
    from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.name`, [orgId])).rows;
  const open = Object.fromEntries((await withOrg(pool, orgId, c => c.query("select assignee_id, count(*)::int n from tickets where org_id = $1 and status in ('open','pending') and assignee_id is not null group by assignee_id", [orgId]))).rows.map(r => [r.assignee_id, r.n]));
  const invites = (await pool.query(`select i.id, i.email, i.role, i."expiresAt" as expires_at from invitation i where i."organizationId" = $1 and i.status = 'pending' and i."expiresAt" > now() order by i."expiresAt" desc`, [orgId])).rows;
  return { ok: true, roles: ROLES, people: people.map(p => ({ memberId: p.member_id, userId: p.user_id, name: p.name, email: p.email, role: p.role, joined: p.joined, lastActive: p.last_active, openTickets: open[p.user_id] || 0 })), invites, seats: { used: await seatsUsed(pool, orgId), allowed: ent.seats === Infinity ? null : ent.seats, plan: ent.plan } };
}
const memberOf = async (pool, orgId, memberId) => (await pool.query('select m.id, m."userId" as user_id, m.role, u.email, u.name from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 and m.id = $2', [orgId, String(memberId || '')])).rows[0];
const owners = async (pool, orgId) => (await pool.query("select count(*)::int n from member where \"organizationId\" = $1 and role = 'owner'", [orgId])).rows[0].n;
export async function changeRole(pool, orgId, actor, actorRole, memberId, role) {
  if (!ROLES.includes(role)) return fail('That role does not exist.');
  const m = await memberOf(pool, orgId, memberId); if (!m) return fail('No such person.', 404);
  if (m.user_id === actor.id) return fail('You cannot change your own role. Ask another owner.');
  if ((m.role === 'owner' || role === 'owner') && actorRole !== 'owner') return fail('Only an owner can do that.', 403);
  if (m.role === 'owner' && role !== 'owner' && await owners(pool, orgId) <= 1) return fail('An organization needs at least one owner.');
  await pool.query('update member set role = $3 where "organizationId" = $1 and id = $2', [orgId, m.id, role]);
  return { ok: true, email: m.email, from: m.role, role };
}
export async function removeMember(pool, orgId, actor, actorRole, memberId, reassignTo) {
  const m = await memberOf(pool, orgId, memberId); if (!m) return fail('No such person.', 404);
  if (m.user_id === actor.id) return fail('You cannot remove yourself here.');
  if (m.role === 'owner' && actorRole !== 'owner') return fail('Only an owner can remove an owner.', 403);
  if (m.role === 'owner' && await owners(pool, orgId) <= 1) return fail('An organization needs at least one owner.');
  let to = null; if (reassignTo) { const t = await memberOf(pool, orgId, reassignTo); if (!t || t.user_id === m.user_id) return fail('Choose a teammate to hand the tickets to.'); to = t.user_id; }
  const moved = await withOrg(pool, orgId, async c => {
    const n = (await c.query("update tickets set assignee_id = $3, updated_at = now() where org_id = $1 and assignee_id = $2 and status in ('open','pending') returning id", [orgId, m.user_id, to])).rowCount;
    await c.query("update tickets set assignee_id = null where org_id = $1 and assignee_id = $2", [orgId, m.user_id]);
    await c.query('delete from ticket_followers where org_id = $1 and user_id = $2', [orgId, m.user_id]);
    return n;
  });
  await pool.query('delete from member where "organizationId" = $1 and id = $2', [orgId, m.id]);
  return { ok: true, email: m.email, reassigned: moved, to };
}
export async function cancelInvite(pool, orgId, inviteId) {
  const r = await pool.query("update invitation set status = 'canceled' where \"organizationId\" = $1 and id = $2 and status = 'pending'", [orgId, String(inviteId || '')]);
  return r.rowCount ? { ok: true } : fail('No such invitation.', 404);
}
export async function resendInvite(pool, mailer, orgId, actor, inviteId) {
  const i = (await pool.query("select id, email, role from invitation where \"organizationId\" = $1 and id = $2 and status = 'pending'", [orgId, String(inviteId || '')])).rows[0]; if (!i) return fail('No such invitation.', 404);
  await pool.query("update invitation set \"expiresAt\" = now() + interval '7 days' where id = $1", [i.id]);
  const org = (await pool.query('select name from "organization" where id = $1', [orgId])).rows[0];
  if (mailer) await mailer.invite(i.email, `${PRODUCT.appUrl}/accept-invitation?id=${encodeURIComponent(i.id)}`, actor.name || actor.email, org ? org.name : '');
  return { ok: true, email: i.email };
}
