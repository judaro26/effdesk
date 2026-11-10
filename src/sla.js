// src/sla.js: SLA TARGETS. Per priority, a time to the first public reply and a time to solve, counted around the clock from when the ticket was created. A ticket is "ok", at "risk" (80% of the time used) or "breached"; a target already reached is "met" (or "missed" when it was reached late).
import { withOrg } from './db.js';
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const MAX = 525600;                                              // a year, in minutes
export const RISK_AT = 0.8;
export async function getSla(pool, orgId) {
  return withOrg(pool, orgId, async c => {
    const rows = (await c.query('select priority, first_response_min, resolve_min from sla_policies where org_id = $1', [orgId])).rows, out = {};
    for (const p of PRIORITIES) { const r = rows.find(x => x.priority === p); out[p] = { firstResponseMin: r ? r.first_response_min : null, resolveMin: r ? r.resolve_min : null }; }
    return { ok: true, policies: out };
  });
}
const mins = v => { if (v === null || v === undefined || v === '') return null; const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 1 && n <= MAX ? n : NaN; };
export async function saveSla(pool, orgId, policies) {
  const rows = [];
  for (const p of PRIORITIES) {
    const x = policies && policies[p] || {}, f = mins(x.firstResponseMin), r = mins(x.resolveMin);
    if (Number.isNaN(f) || Number.isNaN(r)) return { ok: false, status: 400, error: `The ${p} targets must be between 1 minute and 1 year.` };
    if (f !== null && r !== null && f > r) return { ok: false, status: 400, error: `For ${p} priority the first reply cannot take longer than solving the ticket.` };
    rows.push([p, f, r]);
  }
  return withOrg(pool, orgId, async c => { for (const [p, f, r] of rows) { if (f === null && r === null) await c.query('delete from sla_policies where org_id = $1 and priority = $2', [orgId, p]); else await c.query('insert into sla_policies (org_id, priority, first_response_min, resolve_min) values ($1,$2,$3,$4) on conflict (org_id, priority) do update set first_response_min = excluded.first_response_min, resolve_min = excluded.resolve_min', [orgId, p, f, r]); } return { ok: true }; });
}
// one target: when it is due and where it stands (pure: the caller passes the policy and the clock)
function target(startMs, minutes, doneMs, nowMs) {
  if (!minutes) return null;
  const due = startMs + minutes * 60000;
  if (doneMs) return { due, state: doneMs <= due ? 'met' : 'missed' };
  return { due, state: nowMs > due ? 'breached' : nowMs > startMs + minutes * 60000 * RISK_AT ? 'risk' : 'ok' };
}
// the SLA of one ticket row (created_at, first_response_at, solved_at, status, priority); null when its priority has no targets
export function slaOf(t, policies, nowMs = Date.now()) {
  const p = policies && policies[t.priority]; if (!p || (!p.firstResponseMin && !p.resolveMin)) return null;
  const start = new Date(t.created_at).getTime(), ms = v => v ? new Date(v).getTime() : 0, finished = t.status === 'solved' || t.status === 'closed';
  const first = target(start, p.firstResponseMin, ms(t.first_response_at), nowMs), resolve = target(start, p.resolveMin, finished ? ms(t.solved_at) || nowMs : 0, nowMs);
  const rank = { breached: 3, missed: 2, risk: 1, ok: 0, met: 0 }, all = [first, resolve].filter(Boolean);
  const worst = all.reduce((w, x) => rank[x.state] > rank[w] ? x.state : w, 'ok');
  return { first, resolve, worst: all.length && all.every(x => x.state === 'met') ? 'met' : worst };
}
// SQL for "active tickets whose target is past (breached) or past 80% but not over (risk)"; the policy table is joined by priority
export function slaWhere(kind) {
  const over = f => `(p.first_response_min is not null and tickets.first_response_at is null and now() > tickets.created_at + p.first_response_min * ${f} * interval '1 minute') or (p.resolve_min is not null and tickets.solved_at is null and now() > tickets.created_at + p.resolve_min * ${f} * interval '1 minute')`;
  const exists = cond => `tickets.status in ('open','pending') and exists (select 1 from sla_policies p where p.org_id = tickets.org_id and p.priority = tickets.priority and (${cond}))`;
  if (kind === 'breached') return exists(over(1));
  if (kind === 'risk') return `${exists(over(RISK_AT))} and not (${exists(over(1))})`;
  return null;
}
