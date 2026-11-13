// src/roles.js: CUSTOM ROLES (Pro). A team member (not an owner or admin) can be given a custom role that lists what they may do.
//   Reading tickets, internal notes, following and the dashboard are always allowed. Every other action that changes something belongs to one permission; without it the action is refused.
//   Owners and admins are never limited by a custom role. Light agents keep their own rules.
import { withOrg } from './db.js';
export const PERMS = [
  { id: 'reply', label: 'Reply to customers and create tickets', actions: ['reply', 'create'] },
  { id: 'status', label: 'Change status, priority, assignee and fields', actions: ['update'] },
  { id: 'bulk', label: 'Bulk actions', actions: ['bulk'] },
  { id: 'merge', label: 'Merge, link and use side conversations', actions: ['merge', 'link', 'unlink', 'problem-resolve', 'side-send', 'side-close'] },
  { id: 'edit', label: 'Edit messages and remove attachments', actions: ['edit-message', 'delete-file'] },
  { id: 'labels', label: 'Change labels', actions: ['labels'] },
  { id: 'macros', label: 'Manage macros and saved views', actions: ['macro-save', 'macro-delete', 'view-save', 'view-delete'] },
  { id: 'clients', label: 'Manage clients and queues', actions: ['client-save', 'client-delete', 'client-notes', 'contact-save', 'queue-save', 'queue-delete'] },
  { id: 'articles', label: 'Write and delete help articles', actions: ['article-save', 'article-delete'] },
  { id: 'reports', label: 'See reports', actions: ['report', 'report-csv'] },
  { id: 'ai', label: 'Use AI to draft and rewrite replies', actions: ['ai-suggest', 'ai-rewrite'] },
  { id: 'approvals', label: 'Approve service requests, changes and manage fulfillment tasks', actions: ['approval-decide', 'task-update', 'itsm-change-decide'] },
  { id: 'itsm', label: 'Manage ITSM incidents, problems, changes, services and configuration items', actions: ['itsm-incident-save', 'itsm-service-save', 'itsm-problem-save', 'itsm-change-save', 'itsm-ci-save', 'itsm-ci-relationship-save', 'itsm-ci-record-link', 'itsm-ci-vendor-save', 'itsm-ci-contract-save', 'itsm-ci-license-save'] },
];
const PERM_OF = Object.fromEntries(PERMS.flatMap(p => p.actions.map(a => [a, p.id])));
const fail = (error, status = 400) => ({ ok: false, status, error });
export const permFor = action => PERM_OF[action] || null;
// the custom role of a person in an organization, or null
export const customRoleOf = async (pool, orgId, userId) => withOrg(pool, orgId, async c => (await c.query('select r.id, r.name, r.permissions from member_custom_role m join custom_roles r on r.id = m.role_id where m.org_id = $1 and m.user_id = $2', [orgId, userId])).rows[0] || null);
export async function listRoles(pool, orgId) {
  const rows = await withOrg(pool, orgId, async c => (await c.query('select r.id, r.name, r.permissions, (select count(*)::int from member_custom_role m where m.role_id = r.id) as people from custom_roles r where r.org_id = $1 order by r.name', [orgId])).rows);
  const assigned = await withOrg(pool, orgId, async c => (await c.query('select user_id, role_id from member_custom_role where org_id = $1', [orgId])).rows);
  const people = (await pool.query(`select u.id as user_id, u.name, u.email, m.role from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 order by u.name`, [orgId])).rows;
  const by = Object.fromEntries(assigned.map(a => [a.user_id, a.role_id]));
  return { ok: true, perms: PERMS.map(p => ({ id: p.id, label: p.label })), roles: rows.map(r => ({ id: r.id, name: r.name, permissions: r.permissions, people: r.people })), people: people.map(p => ({ userId: p.user_id, name: p.name, email: p.email, role: p.role, customRoleId: by[p.user_id] || null })) };
}
export async function saveRole(pool, orgId, b) {
  const name = String(b.name || '').trim().slice(0, 40); if (!name) return fail('Give the role a name.');
  const perms = [...new Set((Array.isArray(b.permissions) ? b.permissions : []).map(String))]; if (perms.some(p => !PERMS.find(x => x.id === p))) return fail('One of those permissions does not exist.');
  try {
    return await withOrg(pool, orgId, async c => {
      if (b.id) { const u = await c.query('update custom_roles set name = $3, permissions = $4 where org_id = $1 and id = $2 returning id', [orgId, Number(b.id), name, perms]); if (!u.rowCount) return fail('No such role.', 404); return { ok: true, id: u.rows[0].id, name }; }
      if ((await c.query('select count(*)::int n from custom_roles where org_id = $1', [orgId])).rows[0].n >= 20) return fail('You can have up to 20 custom roles.');
      return { ok: true, id: (await c.query('insert into custom_roles (org_id, name, permissions) values ($1,$2,$3) returning id', [orgId, name, perms])).rows[0].id, name };
    });
  } catch (e) { if (e.code === '23505') return fail('A role with that name already exists.'); throw e; }
}
export const deleteRole = async (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from custom_roles where org_id = $1 and id = $2', [orgId, Number(id)])).rowCount > 0);
export async function assignRole(pool, orgId, userId, roleId) {
  const m = (await pool.query('select role from member where "organizationId" = $1 and "userId" = $2', [orgId, String(userId)])).rows[0]; if (!m) return fail('No such person.', 404);
  return withOrg(pool, orgId, async c => {
    if (!roleId) { await c.query('delete from member_custom_role where org_id = $1 and user_id = $2', [orgId, String(userId)]); return { ok: true, role: null }; }
    if (m.role !== 'member') return fail('Custom roles are for full agents. Owners and admins already have every permission, and light agents have their own rules.');
    const r = (await c.query('select name from custom_roles where org_id = $1 and id = $2', [orgId, Number(roleId)])).rows[0]; if (!r) return fail('No such role.', 404);
    await c.query('insert into member_custom_role (org_id, user_id, role_id) values ($1,$2,$3) on conflict (org_id, user_id) do update set role_id = excluded.role_id', [orgId, String(userId), Number(roleId)]);
    return { ok: true, role: r.name };
  });
}
export const clearAssignment = async (pool, orgId, userId) => withOrg(pool, orgId, c => c.query('delete from member_custom_role where org_id = $1 and user_id = $2', [orgId, String(userId)]));
