// src/reports.js: REPORTS over the last 7, 30 or 90 days of tickets: volume per day, where tickets stand, who solved what, how fast the team answers and solves, SLA compliance, busiest labels; and the same tickets as a CSV. Read-only.
import { withOrg } from './db.js';
import { getSla, slaOf } from './sla.js';
import { calendarOf } from './hours.js';

export const RANGES = [7, 30, 90];
const ROW_CAP = 5000;
const mins = (a, b) => a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000)) : null;
const med = a => { const x = a.filter(v => v !== null).sort((p, q) => p - q); return x.length ? (x.length % 2 ? x[(x.length - 1) / 2] : Math.round((x[x.length / 2 - 1] + x[x.length / 2]) / 2)) : null; };
const avg = a => { const x = a.filter(v => v !== null); return x.length ? Math.round(x.reduce((s, v) => s + v, 0) / x.length) : null; };
async function windowRows(c, orgId, days) {
  return (await c.query(`select t.number, t.subject, t.status, t.priority, t.type, t.channel, t.requester_name, t.requester_email, t.tags, t.created_at, t.first_response_at, t.solved_at, u.name assignee_name, u.email assignee_email, q.name queue_name
    from tickets t left join "user" u on u.id = t.assignee_id left join queues q on q.id = t.queue_id and q.org_id = t.org_id
    where t.org_id = $1 and t.created_at >= now() - ($2::int * interval '1 day') order by t.created_at desc limit ${ROW_CAP}`, [orgId, days])).rows;
}
const tally = (rows, f) => { const m = new Map(); for (const r of rows) { const k = f(r); if (k) m.set(k, (m.get(k) || 0) + 1); } return [...m].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)); };
export async function report(pool, orgId, daysIn, now = Date.now()) {
  const days = RANGES.includes(Number(daysIn)) ? Number(daysIn) : 30, sla = (await getSla(pool, orgId)).policies, cal = await calendarOf(pool, orgId);
  return withOrg(pool, orgId, async c => {
    const rows = await windowRows(c, orgId, days);
    const perDay = (await c.query(`select to_char(d, 'YYYY-MM-DD') as day, (select count(*)::int from tickets t where t.org_id = $1 and t.created_at::date = d) created, (select count(*)::int from tickets t where t.org_id = $1 and t.solved_at::date = d) solved
      from generate_series(current_date - ($2::int - 1), current_date, interval '1 day') d order by d`, [orgId, days])).rows;
    const first = rows.map(r => mins(r.created_at, r.first_response_at)), res = rows.filter(r => r.solved_at).map(r => mins(r.created_at, r.solved_at));
    const slas = rows.map(r => slaOf(r, sla, now, cal)).filter(Boolean), judged = slas.filter(s => s.worst !== 'ok'), good = judged.filter(s => s.worst === 'met').length;
    const cs = (await c.query("select count(*)::int sent, count(rating)::int rated, count(*) filter (where rating = 1)::int good from csat_ratings where org_id = $1 and sent_at >= now() - ($2::int * interval '1 day')", [orgId, days])).rows[0];
    return { ok: true, days, csat: { sent: cs.sent, rated: cs.rated, good: cs.good, rate: cs.rated ? Math.round(100 * cs.good / cs.rated) : null }, total: rows.length, truncated: rows.length >= ROW_CAP, perDay,
      byStatus: tally(rows, r => r.status), byPriority: tally(rows, r => r.priority), byChannel: tally(rows, r => r.channel), byType: tally(rows, r => r.type), byQueue: tally(rows, r => r.queue_name),
      solvedBy: tally(rows.filter(r => r.solved_at), r => r.assignee_name || r.assignee_email), labels: tally(rows.flatMap(r => (r.tags || []).map(t => ({ t }))), r => r.t).slice(0, 10),
      firstReply: { avgMin: avg(first), medianMin: med(first), answered: first.filter(v => v !== null).length }, resolution: { avgMin: avg(res), medianMin: med(res), solved: res.length },
      sla: slas.length ? { judged: judged.length, met: good, rate: judged.length ? Math.round(100 * good / judged.length) : null, breached: slas.filter(s => s.worst === 'breached' || s.worst === 'missed').length } : null };
  });
}
// a spreadsheet cell that starts with = + - or @ would run as a formula when opened; a quote in front makes it plain text
const cell = v => { let s = String(v == null ? '' : v).replace(/\r?\n/g, ' '); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return /[",]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export async function reportCsv(pool, orgId, daysIn) {
  const days = RANGES.includes(Number(daysIn)) ? Number(daysIn) : 30, rows = await withOrg(pool, orgId, c => windowRows(c, orgId, days)), iso = v => v ? new Date(v).toISOString() : '';
  const head = ['number', 'subject', 'status', 'priority', 'type', 'channel', 'requester', 'assignee', 'queue', 'labels', 'created', 'first_reply_minutes', 'solved', 'solve_minutes'];
  const lines = rows.map(r => [r.number, r.subject, r.status, r.priority, r.type, r.channel, r.requester_email, r.assignee_name || r.assignee_email || '', r.queue_name || '', (r.tags || []).join(' '), iso(r.created_at), mins(r.created_at, r.first_response_at) ?? '', iso(r.solved_at), mins(r.created_at, r.solved_at) ?? ''].map(cell).join(','));
  return { ok: true, filename: `effdesk-tickets-${days}d.csv`, csv: [head.join(','), ...lines].join('\r\n') + '\r\n', count: rows.length };
}
