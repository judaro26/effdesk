// src/errors.js: ERROR TRACKING. Every failure (a crash, a 5xx answer, a console.error, a browser script error) becomes one row per kind with a count, so 500 identical failures are one line and one email. New kinds, kinds that come back after being resolved, and kinds that are still happening an hour after the last email send an email to the platform owners; the admin console lists them with the request id to search for in the logs.
//   Rows hold no customer content: function, error name, a scrubbed message (300 characters), 6 stack lines, path without query, status, request id, deploy, workspace id.
import crypto from 'node:crypto';
import { platformAdmins } from './config.js';

const clean = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').slice(0, n);
// the same failure must give the same fingerprint whatever the ids and numbers in the message: strip uuids, long hex, digits and quoted values
export const normalize = m => clean(m, 300).toLowerCase().replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, '#').replace(/\b[0-9a-f]{12,}\b/g, '#').replace(/\d+/g, '#').replace(/'[^']*'|"[^"]*"/g, '?').trim();
const firstFrame = s => (String(s || '').split('\n').find(l => /^\s*at /.test(l)) || '').replace(/:\d+:\d+\)?$/, '').replace(/\(.*[\\/]/, '(').trim();
export const fingerprint = e => crypto.createHash('sha1').update([e.source || 'server', e.fn || '', e.name || '', normalize(e.message), firstFrame(e.stack)].join('|')).digest('hex').slice(0, 20);

// returns { ok, id, first, alerted }; never throws
export async function recordError(pool, mailer, env, e, now = Date.now()) {
  try {
    const entry = { source: e.source === 'browser' ? 'browser' : 'server', fn: clean(e.fn, 60), name: clean(e.name, 80) || 'Error', message: clean(e.message, 300), stack: clean(e.stack, 1200), path: clean(e.path, 200).split('?')[0], status: Number.isInteger(e.status) ? e.status : null, request_id: clean(e.request_id, 40) || null, deploy: clean(e.deploy, 20) || null, org_id: clean(e.org, 60) || null };
    entry.fingerprint = fingerprint(entry);
    const r = (await pool.query(`insert into error_events (fingerprint, source, fn, name, message, stack, path, status, request_id, deploy, org_id, first_seen, last_seen)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      on conflict (fingerprint) do update set count = error_events.count + 1, last_seen = $12, request_id = coalesce(excluded.request_id, error_events.request_id), deploy = coalesce(excluded.deploy, error_events.deploy), path = excluded.path,
        status = coalesce(excluded.status, error_events.status), org_id = coalesce(excluded.org_id, error_events.org_id)
      returning id, count, resolved_at, last_alerted_at, (xmax = 0) as inserted`, [entry.fingerprint, entry.source, entry.fn, entry.name, entry.message, entry.stack, entry.path, entry.status, entry.request_id, entry.deploy, entry.org_id, new Date(now).toISOString()])).rows[0];
    const reopened = !!r.resolved_at, stale = !r.last_alerted_at || now - new Date(r.last_alerted_at).getTime() > 3600e3;
    const alert = r.inserted || reopened || stale;
    if (reopened) await pool.query('update error_events set resolved_at = null where id = $1', [r.id]);
    let alerted = false;
    if (alert) alerted = await alertOwners(pool, mailer, env, { ...entry, id: r.id, count: r.count, reopened, first: r.inserted }, now);
    return { ok: true, id: r.id, first: !!r.inserted, alerted };
  } catch (err) { try { console.warn('could not record an error:', err.message); } catch { } return { ok: false }; }
}
async function alertOwners(pool, mailer, env, e, now) {
  const to = platformAdmins(); if (!to.length || !mailer || !mailer.platformNotice) return false;
  const where = e.source === 'browser' ? 'in the browser (' + (e.path || '?') + ')' : 'in ' + (e.fn || 'a function') + (e.status ? ' (answered ' + e.status + ')' : '');
  const subject = `EffDesk ${e.reopened ? 'error is back' : e.first ? 'new error' : 'error still happening'}: ${e.name}: ${e.message}`.slice(0, 150);
  const base = env.APP_URL ? String(env.APP_URL).replace(/\/+$/, '') : 'https://app.effdesk.com';
  const text = [`${e.name}: ${e.message}`, `Where: ${where}`, `Seen ${e.count} time${e.count === 1 ? '' : 's'}${e.deploy ? ', deploy ' + e.deploy : ''}`, e.request_id ? `Request id (search the logs for it): ${e.request_id}` : '', '', e.stack ? e.stack.split('\n').slice(0, 6).join('\n') : '', '', `Open ${base}/admin.html#errors to see it, mark it resolved, or look at the rest.`].filter(x => x !== '').join('\n');
  try { await mailer.platformNotice({ to, subject, text }); await pool.query('update error_events set last_alerted_at = $2 where id = $1', [e.id, new Date(now).toISOString()]); return true; } catch { return false; }
}

export async function listErrors(pool, { state = 'open', limit = 100 } = {}) {
  const w = state === 'resolved' ? 'resolved_at is not null' : state === 'all' ? 'true' : 'resolved_at is null';
  const rows = (await pool.query(`select id, source, fn, name, message, stack, path, status, request_id, deploy, org_id, count, first_seen, last_seen, resolved_at from error_events where ${w} order by last_seen desc limit $1`, [Math.min(500, Number(limit) || 100)])).rows;
  const sum = (await pool.query(`select count(*) filter (where resolved_at is null)::int as open, count(*) filter (where resolved_at is null and last_seen > now() - interval '24 hours')::int as recent, coalesce(sum(count) filter (where last_seen > now() - interval '24 hours'), 0)::int as occurrences24 from error_events`)).rows[0];
  return { ok: true, errors: rows, summary: sum };
}
export async function setResolved(pool, id, resolved) { const r = await pool.query(resolved ? 'update error_events set resolved_at = now() where id = $1' : 'update error_events set resolved_at = null where id = $1', [Number(id) || 0]); return r.rowCount ? { ok: true } : { ok: false, status: 404, error: 'No such error.' }; }
export async function deleteError(pool, id) { await pool.query('delete from error_events where id = $1', [Number(id) || 0]); return { ok: true }; }
export const openCount = async pool => (await pool.query('select count(*)::int n from error_events where resolved_at is null')).rows[0].n;

// a script error reported by a browser: strangers can post these, so what is stored is capped and the number of new kinds per day is limited
export async function recordBrowserError(pool, mailer, env, b, now = Date.now()) {
  const message = clean(b && b.message, 300); if (!message) return { ok: false, status: 400, error: 'Nothing to record.' };
  const fp = fingerprint({ source: 'browser', fn: 'browser', name: clean(b.name, 80) || 'Error', message, stack: clean(b.stack, 1200) });
  const known = (await pool.query('select 1 from error_events where fingerprint = $1', [fp])).rowCount;
  if (!known && (await pool.query("select count(*)::int n from error_events where source = 'browser' and first_seen > now() - interval '24 hours'")).rows[0].n >= 100) return { ok: true, dropped: true };
  const page = (() => { try { return new URL(String(b.page || ''), 'https://x.test').pathname; } catch { return ''; } })();
  return recordError(pool, mailer, env, { source: 'browser', fn: 'browser', name: clean(b.name, 80) || 'Error', message, stack: clean(b.stack, 1200), path: page }, now);
}
