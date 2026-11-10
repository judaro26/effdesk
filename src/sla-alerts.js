// src/sla-alerts.js: SLA ALERT EMAILS. Every hour: for each organization on a plan with SLA, each active ticket that has reached "at risk" (80% of a target) or "breached" is emailed once per state to its owner,
// or to the owners and admins when nobody has it. People who switched notifications off are skipped.
import { withOrg } from './db.js';
import { getSla, slaOf } from './sla.js';
import { calendarOf } from './hours.js';
import { PRODUCT } from './config.js';
import { getEntitlements } from './billing.js';
import { has } from './plans.js';
export async function runSlaAlerts(pool, mailer, env = process.env, nowMs = Date.now()) {
  let sent = 0; if (!mailer || !mailer.agentNotice) return { sent };
  try {
    for (const { id: orgId, name: orgName } of (await pool.query('select id, name from "organization"')).rows) {
      if (!has(await getEntitlements(pool, orgId), 'sla')) continue;
      const policies = (await getSla(pool, orgId)).policies; if (!Object.values(policies).some(p => p.firstResponseMin || p.resolveMin)) continue;
      const cal = await calendarOf(pool, orgId);
      const tickets = (await withOrg(pool, orgId, c => c.query("select id, number, subject, priority, status, assignee_id, created_at, first_response_at, solved_at from tickets where org_id = $1 and status in ('open','pending') order by updated_at desc limit 2000", [orgId]))).rows;
      for (const t of tickets) {
        const s = slaOf(t, policies, nowMs, cal); if (!s) continue; const st = [s.first, s.resolve].filter(Boolean).map(x => x.state), kind = st.includes('breached') ? 'breached' : st.includes('risk') ? 'risk' : null; if (!kind) continue;
        const fresh = await withOrg(pool, orgId, async c => (await c.query('insert into sla_alerts (ticket_id, org_id, kind) values ($1,$2,$3) on conflict do nothing returning 1', [t.id, orgId, kind])).rowCount); if (!fresh) continue;
        const who = t.assignee_id ? [t.assignee_id] : (await pool.query("select \"userId\" as id from member where \"organizationId\" = $1 and role in ('owner','admin')", [orgId])).rows.map(r => r.id);
        const people = who.length ? (await pool.query('select u.email, coalesce(p.notify, true) notify from "user" u left join desk_prefs p on p.user_id = u.id where u.id = any($1)', [who])).rows.filter(p => p.notify) : [];
        for (const p of people) { try { await mailer.agentNotice(p.email, { kind: kind === 'breached' ? 'sla_breached' : 'sla_risk', orgName, number: t.number, subject: t.subject, summary: kind === 'breached' ? `Priority ${t.priority}: a service-level target has passed.` : `Priority ${t.priority}: 80% of a service-level target has gone.`, url: `${PRODUCT.appUrl}/desk.html?org=${encodeURIComponent(orgId)}&ticket=${t.number}` }); sent++; } catch (e) { console.warn('sla alert not sent:', e.message); } }
      }
    }
  } catch (e) { console.warn('sla alerts error:', e.message); }
  return { sent };
}
