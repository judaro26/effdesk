// src/dashboard.js: THE HOME PAGE OF THE DESK. A few numbers, the tickets that need someone, and what is left to set up. One round trip.
import { withOrg } from './db.js';
import { slaWhere } from './sla.js';
const row = r => ({ number: r.number, subject: r.subject, status: r.status, priority: r.priority, requester: r.requester_name || r.requester_email, updatedAt: r.updated_at });
const COLS = 'number, subject, status, priority, requester_name, requester_email, updated_at';
export async function dashboard(pool, orgId, actor, { sla = false, agents = 1 } = {}) {
  return withOrg(pool, orgId, async c => {
    const one = async (sql, args = [orgId]) => (await c.query(sql, args)).rows[0];
    const n = await one(`select
      count(*) filter (where status = 'open')::int open,
      count(*) filter (where status = 'pending')::int pending,
      count(*) filter (where status in ('open','pending') and assignee_id is null)::int unassigned,
      count(*) filter (where status in ('open','pending') and assignee_id = $2)::int mine,
      count(*) filter (where created_at >= date_trunc('day', now()))::int new_today,
      count(*) filter (where solved_at >= date_trunc('day', now()))::int solved_today,
      count(*) filter (where solved_at >= now() - interval '7 days')::int solved_week,
      count(*)::int total
      from tickets where org_id = $1`, [orgId, actor.id]);
    const mine = (await c.query(`select ${COLS} from tickets where org_id = $1 and status in ('open','pending') and assignee_id = $2 order by updated_at desc limit 5`, [orgId, actor.id])).rows.map(row);
    const unassigned = (await c.query(`select ${COLS} from tickets where org_id = $1 and status in ('open','pending') and assignee_id is null order by case priority when 'urgent' then 0 when 'high' then 1 else 2 end, created_at limit 5`, [orgId])).rows.map(row);
    const breached = sla ? (await one(`select count(*)::int n from tickets where org_id = $1 and ${slaWhere('breached')}`)).n : null;
    const articles = (await one('select count(*)::int n from help_articles where org_id = $1', [orgId])).n;
    const inbox = !!(await one('select inbox from inbox_directory where org_id = $1'))?.inbox;
    return { ok: true, counts: { open: n.open, pending: n.pending, unassigned: n.unassigned, mine: n.mine, newToday: n.new_today, solvedToday: n.solved_today, solvedWeek: n.solved_week, breached },
      mine, unassigned, setup: { inbox, articles: articles > 0, team: agents > 1, firstTicket: n.total > 0 } };
  });
}
