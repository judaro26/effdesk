// src/admin-actions.js: EVERYTHING THE PLATFORM OWNER CAN DO from the admin console, behind one door (POST /api/admin/do { action, ... }, platform owners only; see handlers.js). Every change is written to the platform audit log with who did it.
import { dropEntitlements } from './billing.js';
import crypto from 'node:crypto';
import { listErrors, setResolved, deleteError, openCount, recordError } from './errors.js';
import * as status from './status.js';
import { settings, saveSetting } from './platform-settings.js';
import { ALL_FEATURES, PLANS } from './plans.js';
import { getEntitlements } from './billing.js';
import { shipReport, info as logInfo, error as logError } from './log.js';
import { performanceOverview } from './performance.js';
import { grafanaConfig, testGrafanaConnection, exportGrafanaSnapshot } from './grafana-otlp.js';

const clean = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
const fail = (error, st = 400) => ({ ok: false, status: st, error });
export async function audit(pool, actor, action, target, detail = {}) { try { await pool.query('insert into platform_audit (actor, action, target, detail) values ($1,$2,$3,$4)', [actor, action, target == null ? null : String(target).slice(0, 120), JSON.stringify(detail)]); } catch (e) { console.warn('platform audit not written:', e.message); } }
const orgBySlug = async (pool, slug) => (await pool.query('select id, name, slug from "organization" where slug = $1', [clean(slug, 60).toLowerCase()])).rows[0] || null;
const intOrNull = (v, lo, hi) => { if (v === '' || v == null) return null; const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : undefined; };
const feats = v => [...new Set((Array.isArray(v) ? v : []).map(String).filter(f => ALL_FEATURES.includes(f)))];

export const MUTATING = new Set(['error-resolve', 'error-delete', 'error-test', 'logging-test', 'status-component-save', 'status-component-delete', 'status-incident-create', 'status-incident-update', 'status-incident-edit', 'status-incident-delete', 'settings-save', 'customer-save', 'customer-suspend', 'customer-sandbox-create', 'user-signout', 'user-verify']);

export async function run(action, b, { pool, mailer, env = process.env, actor }) {
  switch (action) {
    // ----- the whole picture on the Overview page
    case 'system': {
      const [errs, st] = await Promise.all([openCount(pool), status.overview(pool)]);
      return { ok: true, openErrors: errs, status: st.overall, openIncidents: st.open.length, maintenance: st.maintenance.length, logging: loggingInfo(env), deploy: String(env.DEPLOY_ID || env.COMMIT_REF || '').slice(0, 12) || null, context: env.CONTEXT || null, alerts: { emailTo: (env.PLATFORM_ADMIN_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean).length }, settings: await settings(pool) };
    }
    // ----- sampled API and database-pool performance
    case 'performance': {
      try { return { ...(await performanceOverview(pool, b.range, env)), grafana: grafanaConfig(env) }; }
      catch (e) {
        logError('performance_dashboard_load_failed', { name: e && e.name || 'Error', code: e && e.code || null });
        return fail('Performance data is temporarily unavailable. The server recorded the failure in Platform Admin → Errors; check the latest admin-do function log entry.', 503);
      }
    }
    case 'performance-grafana-test': { const r = await testGrafanaConnection(env); return r.ok ? { ok: true, ...r } : fail(r.error || 'Grafana Cloud connection test failed.', r.status || 400); }
    case 'performance-grafana-export': { const r = await exportGrafanaSnapshot(pool, env); return r.ok ? { ok: true, ...r } : fail(r.error || 'Grafana Cloud export failed.', r.status || 502); }
    // ----- errors
    case 'errors': return listErrors(pool, { state: b.state, limit: b.limit });
    case 'error-resolve': return setResolved(pool, b.id, b.resolved !== false);
    case 'error-delete': return deleteError(pool, b.id);
    case 'error-test': { const r = await recordError(pool, mailer, env, { fn: 'admin-test', name: 'TestError', message: 'This is a test error from the admin console at ' + new Date().toISOString().slice(11, 19), stack: 'at adminTest (src/admin-actions.js)', path: '/api/admin/do', status: 500, request_id: crypto.randomUUID().slice(0, 12) }); return { ok: true, alerted: r.alerted, id: r.id }; }
    // ----- logging
    case 'logging': return { ok: true, logging: loggingInfo(env) };
    case 'logging-test': {
      const line = { _time: new Date().toISOString(), level: 'info', event: 'logging_test', service: 'effdesk', by: 'admin-console' };
      const res = await shipReport([line], env); logInfo('logging_test', { sinks: res.length });
      return { ok: true, results: res, configured: res.length > 0 };
    }
    // ----- status page
    case 'status-list': return status.adminList(pool);
    case 'status-incident-get': { const i = await status.getIncident(pool, b.id); return i ? { ok: true, incident: i } : fail('No such incident.', 404); }
    case 'status-component-save': return status.saveComponent(pool, b);
    case 'status-component-delete': return status.deleteComponent(pool, b.id);
    case 'status-incident-create': return status.createIncident(pool, actor, b);
    case 'status-incident-update': return status.postUpdate(pool, actor, b.id, b);
    case 'status-incident-edit': return status.editIncident(pool, b.id, b);
    case 'status-incident-delete': return status.deleteIncident(pool, b.id);
    // ----- site-wide settings
    case 'settings-get': return { ok: true, settings: await settings(pool, 0) };
    case 'settings-save': { const keys = ['announcement', 'signups'].filter(k => b[k] !== undefined); if (!keys.length) return fail('Nothing to save.'); let last; for (const k of keys) { last = await saveSetting(pool, k, b[k], actor); if (!last.ok) return last; } return { ok: true, settings: await settings(pool, 0) }; }
    // ----- one customer's settings
    case 'customer-get': {
      const o = await orgBySlug(pool, b.slug); if (!o) return fail('No such customer.', 404);
      const ov = (await pool.query('select seat_limit, mail_per_day, storage_mb, ai_monthly, features_on, features_off, suspended, suspended_reason, note, updated_at, updated_by from org_overrides where org_id = $1', [o.id])).rows[0] || { seat_limit: null, mail_per_day: null, storage_mb: null, ai_monthly: null, features_on: [], features_off: [], suspended: false, suspended_reason: '', note: '' };
      const ent = await getEntitlements(pool, o.id);
      return { ok: true, org: o, overrides: ov, effective: { plan: ent.plan, license: ent.license, seats: ent.seats === Infinity ? null : ent.seats, features: [...ent.features].sort() }, allFeatures: ALL_FEATURES, planFeatures: Object.fromEntries(Object.entries(PLANS).map(([k, p]) => [k, p.features])) };
    }
    case 'customer-save': {
      const o = await orgBySlug(pool, b.slug); if (!o) return fail('No such customer.', 404);
      const seat = intOrNull(b.seatLimit, 1, 100000), mail = intOrNull(b.mailPerDay, 1, 1000000), mb = intOrNull(b.storageMb, 1, 10000000), ai = intOrNull(b.aiMonthly, 0, 10000000);
      if ([seat, mail, mb, ai].includes(undefined)) return fail('Limits are whole numbers, or empty to use the plan\'s.');
      const on = feats(b.featuresOn), off = feats(b.featuresOff).filter(f => !on.includes(f));
      await pool.query(`insert into org_overrides (org_id, seat_limit, mail_per_day, storage_mb, ai_monthly, features_on, features_off, note, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (org_id) do update set seat_limit = $2, mail_per_day = $3, storage_mb = $4, ai_monthly = $5, features_on = $6, features_off = $7, note = $8, updated_at = now(), updated_by = $9`, [o.id, seat, mail, mb, ai, on, off, clean(b.note, 2000), actor]);
      dropEntitlements(o.id);
      await audit(pool, actor, 'customer.settings', o.slug, { seat, mail, mb, ai, on, off }); return { ok: true };
    }
    case 'customer-suspend': {
      const o = await orgBySlug(pool, b.slug); if (!o) return fail('No such customer.', 404); const on = b.suspended === true, why = clean(b.reason, 200);
      if (on && !why) return fail('Say why, so the customer is told.');
      await pool.query(`insert into org_overrides (org_id, suspended, suspended_reason, updated_by) values ($1,$2,$3,$4) on conflict (org_id) do update set suspended = $2, suspended_reason = $3, updated_at = now(), updated_by = $4`, [o.id, on, on ? why : '', actor]);
      dropEntitlements(o.id);
      await audit(pool, actor, on ? 'customer.suspend' : 'customer.restore', o.slug, { why }); return { ok: true };
    }
    // ----- isolated customer sandbox workspace
    case 'customer-sandbox-create': {
      const source = await orgBySlug(pool, b.slug);
      if (!source) return fail('No such customer.', 404);
      const sourceEntitlements = await getEntitlements(pool, source.id);
      const client = await pool.connect();
      try {
        await client.query('begin');
        const current = (await client.query('select id, name, slug, metadata from "organization" where id=$1 for update', [source.id])).rows[0];
        if (!current) { await client.query('rollback'); return fail('No such customer.', 404); }
        const slug = (current.slug.slice(0, 52).replace(/-+$/,'') + '-sandbox').slice(0, 60);
        const existing = (await client.query('select id, name, slug, metadata from "organization" where slug=$1 for update', [slug])).rows[0];
        if (existing) {
          let meta = {}; try { meta = JSON.parse(existing.metadata || '{}'); } catch { }
          if (meta.environment === 'sandbox' && meta.sandboxOf === current.id) {
            await client.query('commit');
            const memberCount = (await pool.query('select count(*)::int n from member where "organizationId"=$1',[existing.id])).rows[0].n;
            await pool.query(`insert into org_overrides(org_id,seat_limit,features_on,note,updated_by) values($1,$2,$3,$4,$5) on conflict(org_id) do update set seat_limit=excluded.seat_limit,features_on=excluded.features_on,note=excluded.note,updated_at=now(),updated_by=excluded.updated_by`, [existing.id, Math.max(2,memberCount), [...sourceEntitlements.features], 'Customer sandbox; isolated from production. No separate subscription.', actor]);
            return { ok: true, existing: true, sandbox: { id: existing.id, name: existing.name, slug: existing.slug }, members: memberCount };
          }
          await client.query('rollback'); return fail('The proposed sandbox address is already in use. Rename the customer workspace first or contact support.', 409);
        }
        const id = crypto.randomUUID();
        const metadata = JSON.stringify({ environment: 'sandbox', sandboxOf: current.id, createdBy: actor, createdAt: new Date().toISOString() });
        await client.query('insert into "organization"(id,name,slug,logo,"createdAt",metadata) values($1,$2,$3,null,now(),$4)', [id, current.name + ' — Sandbox', slug, metadata]);
        const members = await client.query('insert into member(id,"organizationId","userId",role,"createdAt") select gen_random_uuid()::text,$1,"userId",role,now() from member where "organizationId"=$2 returning id', [id, current.id]);
        await client.query(`insert into org_overrides(org_id,seat_limit,features_on,note,updated_by) values($1,$2,$3,$4,$5)
          on conflict(org_id) do update set seat_limit=excluded.seat_limit,features_on=excluded.features_on,note=excluded.note,updated_at=now(),updated_by=excluded.updated_by`,
          [id, Math.max(2, members.rowCount), [...sourceEntitlements.features], 'Customer sandbox; isolated from production. No separate subscription.', actor]);
        await client.query('commit');
        await audit(pool, actor, 'customer.sandbox.create', slug, { source: current.slug, members: members.rowCount });
        return { ok: true, existing: false, sandbox: { id, name: current.name + ' — Sandbox', slug }, members: members.rowCount };
      } catch (e) {
        try { await client.query('rollback'); } catch { }
        if (e.code === '23505') return fail('A sandbox with that address already exists.', 409);
        throw e;
      } finally { client.release(); }
    }
    // ----- people
    case 'user-search': {
      const q = clean(b.q, 100).toLowerCase(); if (q.length < 2) return fail('Type at least two characters of a name or email.');
      const users = (await pool.query(`select u.id, u.name, u.email, u."emailVerified" as verified, u."createdAt" as created_at, (select max(s."updatedAt") from session s where s."userId" = u.id) as last_active, (select count(*)::int from session s where s."userId" = u.id and s."expiresAt" > now()) as sessions from "user" u where lower(u.email) like $1 or lower(u.name) like $1 order by u."createdAt" desc limit 20`, ['%' + q.replace(/[%_]/g, '') + '%'])).rows;
      for (const u of users) u.orgs = (await pool.query('select o.name, o.slug, m.role from member m join "organization" o on o.id = m."organizationId" where m."userId" = $1 order by o.name', [u.id])).rows;
      return { ok: true, users };
    }
    case 'user-signout': { const r = await pool.query('delete from session where "userId" = $1', [clean(b.userId, 80)]); await audit(pool, actor, 'user.signout', b.userId, { sessions: r.rowCount }); return { ok: true, signedOut: r.rowCount }; }
    case 'user-verify': { const r = await pool.query('update "user" set "emailVerified" = true where id = $1 and "emailVerified" = false', [clean(b.userId, 80)]); await audit(pool, actor, 'user.verify', b.userId, {}); return { ok: true, changed: r.rowCount }; }
    // ----- what the owner did
    case 'audit-list': return { ok: true, entries: (await pool.query('select id, at, actor, action, target, detail from platform_audit order by at desc, id desc limit $1', [Math.min(500, Number(b.limit) || 100)])).rows };
    default: return fail('Unknown action.');
  }
}
export function loggingInfo(env) {
  return { axiom: { configured: !!(env.AXIOM_TOKEN && env.AXIOM_DATASET), dataset: env.AXIOM_DATASET || null, domain: env.AXIOM_DOMAIN || 'api.axiom.co' }, drain: { configured: !!env.LOG_DRAIN_URL }, functionLog: true, errorTracking: true };
}
