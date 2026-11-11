// src/platform.js: THE PLATFORM OWNER'S VIEW OF ALL CUSTOMERS. Counts only, never ticket content or customer messages. One line per organization: who, plan and billing state, seats, and how much it is used.
// (Row security keeps each organization's tickets apart, so the counts are asked organization by organization; fine into the hundreds of customers, then move to a daily summary table.)
import { withOrg } from './db.js';
const DAY = 86400000;
export function health(o, now = Date.now()) {
  const age = (now - new Date(o.createdAt).getTime()) / DAY;
  if (o.status === 'canceled' || o.status === 'paused') return 'canceled';
  if (o.status === 'past_due') return 'past_due';
  if (o.tickets.total === 0 && age >= 7) return 'stalled';
  if (o.tickets.last30 >= 200) return 'heavy';
  return o.plan === 'free' ? 'free' : 'healthy';
}
export async function customers(pool, now = Date.now()) {
  const orgs = (await pool.query(`select o.id, o.name, o.slug, o."createdAt" as created_at,
      coalesce(s.plan, 'free') plan, s.status, s.interval, s.seats_paid, s.license, s.current_period_end,
      (select u.email from member m join "user" u on u.id = m."userId" where m."organizationId" = o.id and m.role = 'owner' order by m."createdAt" limit 1) as owner_email,
      (select count(*)::int from member m where m."organizationId" = o.id) as agents,
      (select count(*)::int from invitation i where i."organizationId" = o.id and i.status = 'pending' and i."expiresAt" > now()) as invites,
      (select suspended from org_overrides ov where ov.org_id = o.id) as suspended,
      (select max(se."updatedAt") from session se join member m on m."userId" = se."userId" where m."organizationId" = o.id) as last_active
    from "organization" o left join subscriptions s on s.org_id = o.id order by o."createdAt" desc limit 500`)).rows;
  const out = [];
  for (const o of orgs) {
    const u = await withOrg(pool, o.id, async c => (await c.query(`select
        (select count(*)::int from tickets where org_id = $1) total,
        (select count(*)::int from tickets where org_id = $1 and created_at >= now() - interval '30 days') last30,
        (select max(created_at) from tickets where org_id = $1) last_ticket,
        (select count(*)::int from help_articles where org_id = $1) articles,
        (select count(*)::int from inbox_directory where org_id = $1) inbox,
        (select count(*)::int from api_tokens where org_id = $1) tokens,
        (select count(*)::int from webhooks where org_id = $1) hooks,
        (select count(*)::int from triggers where org_id = $1 and active) rules`, [o.id])).rows[0]);
    const row = { suspended: !!o.suspended, id: o.id, name: o.name, slug: o.slug, createdAt: o.created_at, owner: o.owner_email, plan: o.license ? 'licence' : o.plan, status: o.license ? 'licence' : (o.status || 'none'), interval: o.interval, seatsPaid: o.seats_paid || 0, agents: o.agents, invites: o.invites, lastActive: o.last_active, periodEnd: o.current_period_end,
      tickets: { total: u.total, last30: u.last30, last: u.last_ticket }, articles: u.articles, emailSetUp: u.inbox > 0, apiTokens: u.tokens, webhooks: u.hooks, rules: u.rules };
    row.health = health({ ...row, plan: o.license ? 'pro' : o.plan, status: o.status }, now); out.push(row);
  }
  const by = k => out.filter(x => x.health === k).length;
  return { ok: true, customers: out, totals: { organizations: out.length, paying: out.filter(x => x.plan !== 'free' && x.status !== 'canceled' && x.status !== 'none').length, agents: out.reduce((a, x) => a + x.agents, 0), tickets30: out.reduce((a, x) => a + x.tickets.last30, 0), pastDue: by('past_due'), stalled: by('stalled'), heavy: by('heavy') } };
}
export function csv(list) {
  const cell = v => { let s = String(v == null ? '' : v); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return ['name,slug,owner,plan,status,agents,tickets_30d,tickets_total,last_active,health,created'].concat(list.map(x => [x.name, x.slug, x.owner, x.plan, x.status, x.agents, x.tickets.last30, x.tickets.total, x.lastActive ? new Date(x.lastActive).toISOString() : '', x.health, new Date(x.createdAt).toISOString()].map(cell).join(','))).join('\r\n') + '\r\n';
}
