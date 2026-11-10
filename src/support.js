// src/support.js: SUPPORT ACCESS, PER-CUSTOMER DETAIL AND USAGE HISTORY FOR THE PLATFORM OWNER.
// The platform owner may open any customer's desk read-only (nothing can be changed there); every entry is written to the customer's audit log, which the customer can see.
import { withOrg } from './db.js';
import { getEntitlements } from './billing.js';
// EffDesk support may always look in, read-only. Every visit is written to the customer's audit log and listed to them under Manage > Support access.
// the only desk actions the support view may call: all of them only read
export const SUPPORT_READ = new Set(['init', 'list', 'get', 'dashboard', 'agents', 'labels', 'fields-list', 'team-list', 'agent-detail', 'sla-get', 'sla-hours-get', 'report', 'article-list', 'article-get', 'mail-get', 'rules-list', 'webhooks-list', 'support-enter']);
export const getAccess = async () => ({ active: true, always: true });
export const recentEntries = async (pool, orgId) => withOrg(pool, orgId, async c => (await c.query(`select at, target as who, action from audit_log where org_id = $1 and action like 'support.%' order by at desc limit 10`, [orgId])).rows);

const dayStr = ms => new Date(ms).toISOString().slice(0, 10);
// one line of usage per organization per day. Run every hour for today and yesterday, so a day is final once it has passed.
export async function runUsage(pool, nowMs = Date.now()) {
  let rows = 0;
  for (const { id: orgId } of (await pool.query('select id from "organization"')).rows) {
    const agents = (await pool.query('select count(*)::int n from member where "organizationId" = $1', [orgId])).rows[0].n;
    const active = (await pool.query(`select count(distinct m."userId")::int n from member m join session s on s."userId" = m."userId" where m."organizationId" = $1 and s."updatedAt" >= ($2::date)::timestamp at time zone 'UTC'`, [orgId, dayStr(nowMs)])).rows[0].n;
    for (const [day, today] of [[dayStr(nowMs - 86400000), false], [dayStr(nowMs), true]]) {
      const u = await withOrg(pool, orgId, async c => (await c.query(`select
          (select count(*)::int from tickets where org_id = $1 and created_at >= ($2::date)::timestamp at time zone 'UTC' and created_at < (($2::date) + 1)::timestamp at time zone 'UTC') tickets,
          (select count(*)::int from ticket_messages where org_id = $1 and kind = 'agent' and created_at >= ($2::date)::timestamp at time zone 'UTC' and created_at < (($2::date) + 1)::timestamp at time zone 'UTC') replies`, [orgId, day])).rows[0]);
      await pool.query(`insert into usage_daily (org_id, day, tickets, replies, agents, active_agents) values ($1,$2,$3,$4,$5,$6)
        on conflict (org_id, day) do update set tickets = excluded.tickets, replies = excluded.replies, agents = case when $7 then excluded.agents else usage_daily.agents end, active_agents = case when $7 then excluded.active_agents else usage_daily.active_agents end`, [orgId, day, u.tickets, u.replies, today ? agents : 0, today ? active : 0, today]); rows++;
    }
  }
  return { rows };
}
// every API request adds one to today's count (never lets a counting problem fail the request)
export const countApiCall = (pool, orgId) => pool.query(`insert into usage_daily (org_id, day, api_calls) values ($1, (now() at time zone 'utc')::date, 1) on conflict (org_id, day) do update set api_calls = usage_daily.api_calls + 1`, [orgId]).catch(() => null);
export const usageHistory = async (pool, orgId, days = 30) => (await pool.query(`select to_char(day, 'YYYY-MM-DD') as day, tickets, replies, agents, active_agents, api_calls from usage_daily where org_id = $1 and day > (now() at time zone 'utc')::date - $2::int order by day`, [orgId, days])).rows;

// everything the platform owner sees about one customer: team and access, billing, usage and flags. Never ticket content.
export async function customerDetail(pool, slug, nowMs = Date.now()) {
  const o = (await pool.query(`select o.id, o.name, o.slug, o."createdAt" as created_at, s.plan, s.status, s.interval, s.seats_paid, s.license, s.current_period_end from "organization" o left join subscriptions s on s.org_id = o.id where o.slug = $1`, [String(slug || '').toLowerCase()])).rows[0];
  if (!o) return { ok: false, status: 404, error: 'No such customer.' };
  const ent = await getEntitlements(pool, o.id);
  const people = (await pool.query(`select u.name, u.email, m.role, m."createdAt" as joined, (select max(s."updatedAt") from session s where s."userId" = u.id) as last_active from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.name`, [o.id])).rows;
  const usage = await usageHistory(pool, o.id, 30), access = await getAccess(pool, o.id, nowMs);
  const sum = k => usage.reduce((a, x) => a + x[k], 0), seats = ent.seats === Infinity ? null : ent.seats;
  const last = people.map(p => p.last_active && new Date(p.last_active).getTime()).filter(Boolean).sort((a, b) => b - a)[0] || 0;
  const flags = [];
  if (o.status === 'past_due') flags.push({ kind: 'past_due', text: 'The last payment failed.' });
  if (seats && people.length >= seats * 0.9) flags.push({ kind: 'seats', text: `${people.length} of ${seats} seats in use.` });
  if (sum('api_calls') >= 50000) flags.push({ kind: 'api', text: `${sum('api_calls')} API calls in 30 days.` });
  if (last && nowMs - last > 14 * 86400000) flags.push({ kind: 'quiet', text: 'Nobody has signed in for over 14 days.' });
  return { ok: true, customer: { id: o.id, name: o.name, slug: o.slug, createdAt: o.created_at },
    billing: { plan: o.license ? 'licence' : (o.plan || 'free'), status: o.license ? 'licence' : (o.status || 'none'), interval: o.interval || null, seatsPaid: o.seats_paid || 0, seatsUsed: people.length, seatLimit: seats, renews: o.current_period_end || null },
    people: people.map(p => ({ name: p.name, email: p.email, role: p.role, joined: p.joined, lastActive: p.last_active })), usage,
    totals: { tickets: sum('tickets'), replies: sum('replies'), apiCalls: sum('api_calls') }, flags, access, entries: await recentEntries(pool, o.id) };
}
// email the platform owners once a week per problem and customer (seats nearly full, payment failed, gone quiet)
export async function runUsageAlerts(pool, mailer, env = process.env, nowMs = Date.now()) {
  const to = String(env.PLATFORM_ADMIN_EMAILS || '').split(',').map(x => x.trim()).filter(Boolean); let sent = 0;
  if (!to.length || !mailer || !mailer.platformNotice) return { sent };
  for (const { slug, name } of (await pool.query('select slug, name from "organization"')).rows) {
    const d = await customerDetail(pool, slug, nowMs); if (!d.ok) continue;
    for (const f of d.flags) {
      const fresh = await pool.query(`insert into usage_alerts (org_id, kind, sent_at) values ($1,$2,now()) on conflict (org_id, kind) do update set sent_at = now() where usage_alerts.sent_at < now() - interval '7 days' returning kind`, [d.customer.id, f.kind]);
      if (!fresh.rowCount) continue;
      await mailer.platformNotice({ to, subject: `EffDesk: ${name} (${slug}): ${f.text}`, text: `${name} (${slug})\n${f.text}\n\nOpen the admin page, Customers, to see the details.` }).catch(() => null); sent++;
    }
  }
  return { sent };
}
