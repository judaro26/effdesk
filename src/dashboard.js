// src/dashboard.js: tenant-scoped command-center data for the agent workspace.
import { withOrg } from './db.js';
import { slaWhere, slaNumbers } from './sla.js';
const row = r => ({ number: r.number, subject: r.subject, status: r.status, priority: r.priority, requester: r.requester_name || r.requester_email, updatedAt: r.updated_at });
const COLS = 'number, subject, status, priority, requester_name, requester_email, updated_at';
export async function dashboard(pool, orgId, actor, { sla = false, agents = 1, portalDomain = '' } = {}) {
  return withOrg(pool, orgId, async c => {
    // Keep the dashboard's independent read models in one SQL round trip. This
    // avoids repeatedly paying connection/round-trip latency for the same request.
    const result = await c.query(`
      with ticket_counts as (
        select
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
        from tickets where org_id = $1
      ), mine_page as (
        select ${COLS} from tickets
        where org_id = $1 and status in ('open','pending','on_hold') and assignee_id = $2
        order by updated_at desc limit 5
      ), unassigned_page as (
        select ${COLS} from tickets
        where org_id = $1 and status in ('open','pending','on_hold') and assignee_id is null
        order by case priority when 'urgent' then 0 when 'high' then 1 else 2 end, created_at limit 5
      ), recent_page as (
        select ${COLS} from tickets where org_id = $1 order by updated_at desc limit 6
      ), bounds as (
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
      ), daily_rows as (
        select to_char(days.day, 'Dy') as label,
               coalesce(created.n, 0)::int as created,
               coalesce(solved.n, 0)::int as solved
        from days
        left join created on created.day = days.day
        left join solved on solved.day = days.day
        order by days.day
      )
      select ticket_counts.*,
        coalesce((select jsonb_agg(to_jsonb(mine_page)) from mine_page), '[]'::jsonb) as mine,
        coalesce((select jsonb_agg(to_jsonb(unassigned_page)) from unassigned_page), '[]'::jsonb) as unassigned,
        coalesce((select jsonb_agg(to_jsonb(recent_page)) from recent_page), '[]'::jsonb) as recent,
        coalesce((select jsonb_agg(to_jsonb(daily_rows)) from daily_rows), '[]'::jsonb) as daily,
        (select count(*)::int from help_articles where org_id = $1) as articles,
        coalesce((select inbox from inbox_directory where org_id = $1), false) as inbox,
        (select slug from "organization" where id = $1) as slug
      from ticket_counts
    `, [orgId, actor.id]);
    const data = result.rows[0] || {};
    const breached = sla ? (sla.enabled ? (await slaNumbers(pool, orgId, 'breached', sla)).length : (await c.query(`select count(*)::int n from tickets where org_id = $1 and ${slaWhere('breached')}`, [orgId])).rows[0].n) : null;
    return {
      ok: true,
      portal: portalDomain && data.slug ? `https://${data.slug}.${portalDomain}` : '',
      counts: { open: data.open || 0, pending: data.pending || 0, on_hold: data.on_hold || 0, unassigned: data.unassigned || 0, mine: data.mine || 0, urgent: data.urgent || 0, newToday: data.new_today || 0, solvedToday: data.solved_today || 0, solvedWeek: data.solved_week || 0, breached },
      mine: (data.mine || []).map(row), unassigned: (data.unassigned || []).map(row), recent: (data.recent || []).map(row), daily: data.daily || [],
      setup: { inbox: !!data.inbox, articles: (data.articles || 0) > 0, team: agents > 1, firstTicket: (data.total || 0) > 0 }
    };
  });
}
