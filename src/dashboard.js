// src/dashboard.js: tenant-scoped command-center data for the agent workspace.
import { withOrg } from './db.js';
import { slaWhere, slaNumbers } from './sla.js';
const row = r => ({ number: r.number, subject: r.subject, status: r.status, priority: r.priority, requester: r.requester_name || r.requester_email, updatedAt: r.updated_at });
const COLS = 'number, subject, status, priority, requester_name, requester_email, updated_at';
export async function dashboard(pool, orgId, actor, { sla = false, agents = 1, portalDomain = '' } = {}) {
  return withOrg(pool, orgId, async c => {
    const one = async (sql, args = [orgId]) => (await c.query(sql, args)).rows[0];
    const n = await one(`select
      count(*) filter (where status = 'open')::int open,
      count(*) filter (where status = 'pending')::int pending,
      count(*) filter (where status = 'on_hold')::int on_hold,
      count(*) filter (where status in ('open','pending','on_hold') and assignee_id is null)::int unassigned,
      count(*) filter (where status in ('open','pending','on_hold') and assignee_id = $2)::int mine,
      count(*) filter (where status in ('open','pending','on_hold') and priority = 'urgent')::int urgent,
      count(*) filter (where created_at >= date_trunc('day', now()))::int new_today,
      count(*) filter (where solved_at >= date_trunc('day', now()))::int solved_today,
      count(*) filter (where solved_at >= now() - interval '7 days')::int solved_week,
      count(*)::int total
      from tickets where org_id = $1`, [orgId, actor.id]);
    const mine = (await c.query(`select ${COLS} from tickets where org_id = $1 and status in ('open','pending','on_hold') and assignee_id = $2 order by updated_at desc limit 5`, [orgId, actor.id])).rows.map(row);
    const unassigned = (await c.query(`select ${COLS} from tickets where org_id = $1 and status in ('open','pending','on_hold') and assignee_id is null order by case priority when 'urgent' then 0 when 'high' then 1 else 2 end, created_at limit 5`, [orgId])).rows.map(row);
    const recent = (await c.query(`select ${COLS} from tickets where org_id = $1 order by updated_at desc limit 6`, [orgId])).rows.map(row);
    const daily = (await c.query(`
      with bounds as (
        select date_trunc('day', now()) - interval '6 days' as first_day,
               date_trunc('day', now()) + interval '1 day' as after_last_day
      ), days as (
        select generate_series(first_day, after_last_day - interval '1 day', interval '1 day') as day
        from bounds
      ), created as (
        select date_trunc('day', created_at) as day, count(*)::int as n
        from tickets, bounds
        where org_id = $1 and created_at >= bounds.first_day and created_at < bounds.after_last_day
        group by 1
      ), solved as (
        select date_trunc('day', solved_at) as day, count(*)::int as n
        from tickets, bounds
        where org_id = $1 and solved_at >= bounds.first_day and solved_at < bounds.after_last_day
        group by 1
      )
      select to_char(days.day, 'Dy') as label,
             coalesce(created.n, 0)::int as created,
             coalesce(solved.n, 0)::int as solved
      from days
      left join created on created.day = days.day
      left join solved on solved.day = days.day
      order by days.day
    `, [orgId])).rows;
    const breached = sla ? (sla.enabled ? (await slaNumbers(pool, orgId, 'breached', sla)).length : (await one(`select count(*)::int n from tickets where org_id = $1 and ${slaWhere('breached')}`)).n) : null;
    const articles = (await one('select count(*)::int n from help_articles where org_id = $1', [orgId])).n;
    const inbox = !!(await one('select inbox from inbox_directory where org_id = $1'))?.inbox;
    const slug = (await one('select slug from "organization" where id = $1'))?.slug;
    return {
      ok: true,
      portal: portalDomain && slug ? `https://${slug}.${portalDomain}` : '',
      counts: { open: n.open, pending: n.pending, on_hold: n.on_hold, unassigned: n.unassigned, mine: n.mine, urgent: n.urgent, newToday: n.new_today, solvedToday: n.solved_today, solvedWeek: n.solved_week, breached },
      mine, unassigned, recent, daily,
      setup: { inbox, articles: articles > 0, team: agents > 1, firstTicket: n.total > 0 }
    };
  });
}
