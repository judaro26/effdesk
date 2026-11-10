// src/hours.js: BUSINESS HOURS FOR SLA CLOCKS. With business hours on, an SLA target counts only the minutes inside the working windows of the organization's time zone ("4 hours" started Friday 16:00 ends Monday 11:00).
// A calendar is { add(startMs, minutes) -> the time the target falls due }. The default calendar is around the clock.
import { withOrg } from './db.js';
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const ROUND_THE_CLOCK = { enabled: false, add: (startMs, minutes) => startMs + minutes * 60000 };
const fmt = new Map();
const parts = (tz, ms) => { let f = fmt.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', weekday: 'short' }); fmt.set(tz, f); } const o = {}; for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value; return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: DAYS.indexOf(o.weekday.slice(0, 3).toLowerCase()) }; };
const offsetMs = (tz, ms) => { const p = parts(tz, ms); return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000; };
// the UTC time at which the wall clock of tz shows y-m-d hh:mm (a day that does not exist at a clock change lands just after it)
const localToUtc = (tz, y, m, d, hh, mm) => { const guess = Date.UTC(y, m - 1, d, hh, mm); let t = guess - offsetMs(tz, guess); t = guess - offsetMs(tz, t); return t; };
const minutesOf = hhmm => { const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm || '')); return m ? +m[1] * 60 + +m[2] : null; };
export function validate(b) {
  const tz = String(b.tz || '').trim(); try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return { error: 'That time zone is not known. Use a name like America/Los_Angeles.' }; } if (!tz) return { error: 'Choose a time zone.' };
  const schedule = {}; let any = false;
  for (const d of DAYS) { const x = b.schedule && b.schedule[d]; if (!x || (!x.start && !x.end)) continue; const s = minutesOf(x.start), e = minutesOf(x.end); if (s === null || e === null || s >= e) return { error: `Check the hours for ${d}: the start must be before the end (like 09:00 to 17:00).` }; schedule[d] = { start: x.start, end: x.end }; any = true; }
  if (b.enabled !== false && !any) return { error: 'Choose at least one working day, or switch business hours off.' };
  return { value: { enabled: b.enabled !== false, tz, schedule } };
}
export function makeCalendar(cfg) {
  if (!cfg || !cfg.enabled) return ROUND_THE_CLOCK;
  const { tz, schedule } = cfg;
  return { enabled: true, add(startMs, minutes) {
    let cur = startMs, left = Math.max(0, minutes);
    for (let i = 0; i < 400; i++) {
      const p = parts(tz, cur), w = schedule[DAYS[p.wd]];
      if (w) { const ws = localToUtc(tz, p.y, p.m, p.d, 0, 0) + minutesOf(w.start) * 60000, we = localToUtc(tz, p.y, p.m, p.d, 0, 0) + minutesOf(w.end) * 60000, from = Math.max(cur, ws); if (from < we) { const room = (we - from) / 60000; if (left <= room) return from + left * 60000; left -= room; } }
      cur = localToUtc(tz, p.y, p.m, p.d + 1, 0, 0);
    }
    return startMs + minutes * 60000;
  } };
}
export async function getHours(pool, orgId) { return withOrg(pool, orgId, async c => { const r = (await c.query('select enabled, tz, schedule from sla_hours where org_id = $1', [orgId])).rows[0]; return { ok: true, hours: r || { enabled: false, tz: 'UTC', schedule: {} } }; }); }
export async function saveHours(pool, orgId, b) {
  const v = validate(b || {}); if (v.error) return { ok: false, status: 400, error: v.error };
  await withOrg(pool, orgId, c => c.query('insert into sla_hours (org_id, enabled, tz, schedule) values ($1,$2,$3,$4) on conflict (org_id) do update set enabled = $2, tz = $3, schedule = $4', [orgId, v.value.enabled, v.value.tz, JSON.stringify(v.value.schedule)]));
  return { ok: true, hours: v.value };
}
export async function calendarOf(pool, orgId) { return makeCalendar((await getHours(pool, orgId)).hours); }
