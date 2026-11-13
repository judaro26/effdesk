// src/status.js: THE STATUS PAGE. Components (what customers depend on), incidents with a timeline of updates, and planned maintenance. The platform owner manages them in the admin console; everyone sees /status (and /api/status, /status/feed.xml).
//   A component's shown state is the worst of: the state set by hand, any open incident that names it (its impact), planned maintenance happening now, and a live check (the database) for components that have one. Uptime is worked out from the incidents we posted, so it is only as honest as the incidents are.
import { esc } from './help-pages.js';
import { PRODUCT } from './config.js';

export const LEVEL = ['operational', 'maintenance', 'degraded', 'partial_outage', 'major_outage'];
const rank = s => Math.max(0, LEVEL.indexOf(s));
const worse = (a, b) => rank(b) > rank(a) ? b : a;
export const IMPACT_STATE = { none: 'operational', minor: 'degraded', major: 'partial_outage', critical: 'major_outage' };
export const STATE_NAME = { operational: 'Operational', maintenance: 'Under maintenance', degraded: 'Degraded performance', partial_outage: 'Partial outage', major_outage: 'Major outage' };
export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'], MAINT_STATUSES = ['scheduled', 'in_progress', 'completed'];
const STATUS_NAME = { investigating: 'Investigating', identified: 'Identified', monitoring: 'Monitoring', resolved: 'Resolved', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed' };
const clean = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
const fail = (error, status = 400) => ({ ok: false, status, error });
const DAY = 86400000;

// ---------- reading ----------
async function liveChecks(pool) { let db = true; try { await pool.query('select 1'); } catch { db = false; } return { database: db }; }
// sc = the workspace id, or null for the platform's own page
export async function overview(pool, now = Date.now(), sc = null) {
  const comps = (await pool.query('select id, name, description, position, status, auto_check, visible from status_components where org_id is not distinct from $1 order by position, id', [sc])).rows;
  const since = new Date(now - 90 * DAY).toISOString();
  const incs = (await pool.query(`select id, kind, title, status, impact, component_ids, started_at, resolved_at, scheduled_for, scheduled_until from status_incidents where org_id is not distinct from $2 and (started_at > $1 or resolved_at is null or scheduled_until > now()) order by started_at desc limit 300`, [since, sc])).rows;
  const ups = incs.length ? (await pool.query('select id, incident_id, status, body, created_at from status_updates where incident_id = any($1) order by created_at desc, id desc', [incs.map(i => i.id)])).rows : [];
  const byInc = {}; for (const u of ups) (byInc[u.incident_id] = byInc[u.incident_id] || []).push(u);
  const live = sc ? {} : await liveChecks(pool);
  const inc = i => ({ ...i, updates: byInc[i.id] || [] });
  const t = now;
  const open = incs.filter(i => i.kind === 'incident' && i.status !== 'resolved').map(inc);
  const maint = incs.filter(i => i.kind === 'maintenance' && i.status !== 'completed' && (!i.scheduled_until || new Date(i.scheduled_until).getTime() > t)).map(inc).sort((a, b) => new Date(a.scheduled_for) - new Date(b.scheduled_for));
  const maintNow = maint.filter(m => m.status === 'in_progress' || (m.scheduled_for && new Date(m.scheduled_for).getTime() <= t));
  const components = comps.filter(c => c.visible).map(c => {
    let state = c.status;
    for (const i of open) if (i.component_ids.includes(c.id)) state = worse(state, IMPACT_STATE[i.impact]);
    for (const m of maintNow) if (m.component_ids.includes(c.id)) state = worse(state, 'maintenance');
    if (c.auto_check && live[c.auto_check] === false) state = 'major_outage';
    return { id: c.id, name: c.name, description: c.description, state, uptime: uptimeOf(c.id, incs, now), days: daysOf(c.id, incs, now) };
  });
  let all = 'operational'; for (const c of components) all = worse(all, c.state);
  const past = incs.filter(i => i.kind === 'incident' && i.status === 'resolved' && new Date(i.started_at).getTime() > now - 14 * DAY).map(inc);
  return { ok: true, overall: all, components, open, maintenance: maint, past, live, generatedAt: new Date(now).toISOString() };
}
// one entry per day for 90 days: the worst thing that touched the component that day
function daysOf(id, incs, now) {
  const start = Math.floor(now / DAY) * DAY - 89 * DAY, out = [];
  for (let d = 0; d < 90; d++) {
    const from = start + d * DAY, to = from + DAY; let st = 'operational';
    for (const i of incs) {
      if (!i.component_ids.includes(id)) continue;
      const a = new Date(i.kind === 'maintenance' ? i.scheduled_for || i.started_at : i.started_at).getTime(), b = i.resolved_at ? new Date(i.resolved_at).getTime() : i.kind === 'maintenance' ? new Date(i.scheduled_until || a).getTime() : now;
      if (a < to && b >= from) st = worse(st, i.kind === 'maintenance' ? 'maintenance' : IMPACT_STATE[i.impact]);
    }
    out.push({ day: new Date(from).toISOString().slice(0, 10), state: st });
  }
  return out;
}
// uptime over 90 days = time not spent in a partial or major outage, from the incidents posted
function uptimeOf(id, incs, now) {
  const from = now - 90 * DAY; let down = 0;
  for (const i of incs) {
    if (i.kind !== 'incident' || !i.component_ids.includes(id) || !['major', 'critical'].includes(i.impact)) continue;
    const a = Math.max(from, new Date(i.started_at).getTime()), b = i.resolved_at ? new Date(i.resolved_at).getTime() : now; if (b > a) down += b - a;
  }
  return Math.max(0, Math.round((1 - down / (90 * DAY)) * 10000) / 100);
}
export async function getIncident(pool, id, sc = null) {
  const i = (await pool.query('select * from status_incidents where id = $1 and org_id is not distinct from $2', [Number(id) || 0, sc])).rows[0]; if (!i) return null;
  i.updates = (await pool.query('select id, status, body, created_at, created_by from status_updates where incident_id = $1 order by created_at desc, id desc', [i.id])).rows; return i;
}
export async function adminList(pool, sc = null) {
  const comps = (await pool.query('select id, name, description, position, status, auto_check, visible from status_components where org_id is not distinct from $1 order by position, id', [sc])).rows;
  const incs = (await pool.query('select id, kind, title, status, impact, component_ids, started_at, resolved_at, scheduled_for, scheduled_until from status_incidents where org_id is not distinct from $1 order by started_at desc limit 60', [sc])).rows;
  return { ok: true, components: comps, incidents: incs };
}

// ---------- writing (the admin console) ----------
const toIds = (pool, v) => (Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 50);
export async function saveComponent(pool, input, sc = null) {
  const name = clean(input.name, 80), description = clean(input.description, 200), status = LEVEL.includes(input.status) ? input.status : 'operational', pos = Number.isInteger(Number(input.position)) ? Number(input.position) : 0;
  if (!name) return fail('Give the component a name.');
  if (sc && (await pool.query('select count(*)::int n from status_components where org_id = $1', [sc])).rows[0].n >= 30 && !input.id) return fail('A status page can list up to 30 systems.');
  if (input.id) { const r = await pool.query('update status_components set name = $2, description = $3, status = $4, position = $5, visible = $6 where id = $1 and org_id is not distinct from $7 returning id', [Number(input.id), name, description, status, pos, input.visible !== false, sc]); return r.rowCount ? { ok: true, id: r.rows[0].id } : fail('No such component.', 404); }
  const r = await pool.query('insert into status_components (name, description, status, position, visible, org_id) values ($1,$2,$3,$4,$5,$6) returning id', [name, description, status, pos || ((await pool.query('select coalesce(max(position),0)+1 n from status_components where org_id is not distinct from $1', [sc])).rows[0].n), input.visible !== false, sc]); return { ok: true, id: r.rows[0].id };
}
export async function deleteComponent(pool, id, sc = null) { const ok = (await pool.query('select 1 from status_components where id = $1 and org_id is not distinct from $2', [Number(id) || 0, sc])).rowCount; if (!ok) return fail('No such component.', 404); await pool.query('update status_incidents set component_ids = array_remove(component_ids, $1) where $1 = any(component_ids) and org_id is not distinct from $2', [Number(id) || 0, sc]); await pool.query('delete from status_components where id = $1', [Number(id) || 0]); return { ok: true }; }
const when = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? undefined : d.toISOString(); };
export async function createIncident(pool, actor, input, sc = null) {
  const kind = input.kind === 'maintenance' ? 'maintenance' : 'incident', title = clean(input.title, 140), body = clean(input.body, 4000);
  if (!title) return fail('Give it a title people will understand.'); if (!body) return fail('Write the first update.');
  const impact = ['none', 'minor', 'major', 'critical'].includes(input.impact) ? input.impact : kind === 'maintenance' ? 'none' : 'minor';
  const ids = toIds(pool, input.componentIds), own = ids.length ? (await pool.query('select id from status_components where id = any($1) and org_id is not distinct from $2', [ids, sc])).rows.map(r => Number(r.id)) : []; ids.splice(0, ids.length, ...ids.filter(x => own.includes(x)));
  let status, sf = null, su = null;
  if (kind === 'maintenance') {
    sf = when(input.scheduledFor); su = when(input.scheduledUntil); if (!sf || !su) return fail('Choose when the maintenance starts and ends.'); if (new Date(su) <= new Date(sf)) return fail('The end must be after the start.');
    status = 'scheduled';
  } else status = INCIDENT_STATUSES.includes(input.status) && input.status !== 'resolved' ? input.status : 'investigating';
  const i = (await pool.query('insert into status_incidents (kind, title, status, impact, component_ids, scheduled_for, scheduled_until, created_by, org_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id', [kind, title, status, impact, ids, sf, su, clean(actor, 120), sc])).rows[0];
  await pool.query('insert into status_updates (incident_id, status, body, created_by) values ($1,$2,$3,$4)', [i.id, status, body, clean(actor, 120)]);
  return { ok: true, id: i.id };
}
// post an update: changes the status (and optionally the impact and the components), and resolving closes it
export async function postUpdate(pool, actor, id, input, sc = null) {
  const i = (await pool.query('select * from status_incidents where id = $1 and org_id is not distinct from $2', [Number(id) || 0, sc])).rows[0]; if (!i) return fail('No such incident.', 404);
  const allowed = i.kind === 'maintenance' ? MAINT_STATUSES : INCIDENT_STATUSES, status = allowed.includes(input.status) ? input.status : i.status, body = clean(input.body, 4000);
  if (!body) return fail('Write what changed.');
  const impact = ['none', 'minor', 'major', 'critical'].includes(input.impact) ? input.impact : i.impact, ids = input.componentIds ? toIds(pool, input.componentIds) : i.component_ids; if (input.componentIds && ids.length) { const own = (await pool.query('select id from status_components where id = any($1) and org_id is not distinct from $2', [ids, sc])).rows.map(r => Number(r.id)); ids.splice(0, ids.length, ...ids.filter(x => own.includes(x))); }
  const done = status === 'resolved' || status === 'completed';
  await pool.query('update status_incidents set status = $2, impact = $3, component_ids = $4, resolved_at = case when $5 then coalesce(resolved_at, now()) else null end where id = $1', [i.id, status, impact, ids, done]);
  await pool.query('insert into status_updates (incident_id, status, body, created_by) values ($1,$2,$3,$4)', [i.id, status, body, clean(actor, 120)]);
  return { ok: true };
}
export async function editIncident(pool, id, input, sc = null) {
  const title = clean(input.title, 140); if (!title) return fail('Give it a title.');
  const r = await pool.query('update status_incidents set title = $2 where id = $1 and org_id is not distinct from $3', [Number(id) || 0, title, sc]); return r.rowCount ? { ok: true } : fail('No such incident.', 404);
}
export async function deleteIncident(pool, id, sc = null) { await pool.query('delete from status_incidents where id = $1 and org_id is not distinct from $2', [Number(id) || 0, sc]); return { ok: true }; }

// ---------- the public pages ----------
const fmt = v => { try { return new Date(v).toLocaleString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' UTC'; } catch { return ''; } };
const BANNER = { operational: ['All systems operational', 'ok'], maintenance: ['Scheduled maintenance in progress', 'maint'], degraded: ['Some systems are slower than usual', 'warn'], partial_outage: ['Some systems are not working', 'bad'], major_outage: ['We are having a major outage', 'bad'] };
function updatesHtml(ups) { return `<ul class="upd">${ups.map(u => `<li><strong>${esc(STATUS_NAME[u.status] || u.status)}</strong> <span class="m">${esc(fmt(u.created_at))}</span><p>${esc(u.body).replace(/\n/g, '<br>')}</p></li>`).join('')}</ul>`; }
function incidentHtml(i, base, link = true) {
  const names = i.component_ids || [];
  return `<article class="inc impact-${esc(i.impact)}" id="i${i.id}"><h3>${link ? `<a href="${base}/incidents/${i.id}">${esc(i.title)}</a>` : esc(i.title)}</h3>
    <p class="m">${i.kind === 'maintenance' ? `${esc(fmt(i.scheduled_for))} to ${esc(fmt(i.scheduled_until))}` : esc(fmt(i.started_at)) + (i.resolved_at ? ` to ${esc(fmt(i.resolved_at))}` : '')} · <span class="pill s-${esc(i.status)}">${esc(STATUS_NAME[i.status] || i.status)}</span></p>${updatesHtml(i.updates || [])}</article>`;
}
export function renderPage(d, { base = '/status', title = PRODUCT.name + ' status', json = '/api/status', brand = null } = {}) {
  const [msg, tone] = BANNER[d.overall] || BANNER.operational;
  const comps = d.components.map(c => `<li class="comp"><div class="ch"><div><strong>${esc(c.name)}</strong>${c.description ? `<div class="m">${esc(c.description)}</div>` : ''}</div><span class="st st-${esc(c.state)}">${esc(STATE_NAME[c.state] || c.state)}</span></div>
    <div class="bars" role="img" aria-label="${esc(c.name)}: last 90 days">${c.days.map(x => `<i class="b-${esc(x.state)}" title="${esc(x.day)}: ${esc(STATE_NAME[x.state])}"></i>`).join('')}</div><div class="bl m"><span>90 days ago</span><span>${c.uptime}% uptime</span><span>Today</span></div></li>`).join('');
  const body = `<h1>${esc(title)}</h1><div class="banner ${tone}" role="status">${esc(msg)}</div>
${d.open.length ? `<h2>Current incidents</h2>${d.open.map(i => incidentHtml(i, base)).join('')}` : ''}
${d.maintenance.length ? `<h2>Planned maintenance</h2>${d.maintenance.map(i => incidentHtml(i, base)).join('')}` : ''}
<h2>Systems</h2>${comps ? `<ul class="comps">${comps}</ul>` : '<p class="m">No systems are listed yet.</p>'}
<h2>Past incidents</h2>${d.past.length ? d.past.map(i => incidentHtml(i, base)).join('') : '<p class="m">No incidents in the last 14 days.</p>'}
<p class="m">Updated ${esc(fmt(d.generatedAt))}. This page refreshes itself every minute. <a href="${base}/feed.xml">Subscribe with a feed reader</a> · <a href="${json}">JSON</a></p>`;
  return shell(title, body, true, brand, base);
}
export function renderIncident(i, base = '/status', brand = null) { return shell(i.title + ' | ' + (brand ? brand.name : PRODUCT.name) + ' status', `<p><a href="${base}">← All systems</a></p>${incidentHtml(i, base, false)}`, false, brand, base); }
function shell(title, body, refresh = true, brand = null, base = '/status') {
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh ? '<meta http-equiv="refresh" content="60">' : ''}<title>${esc(title)}</title><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/status.css"><link rel="alternate" type="application/atom+xml" href="${esc(base)}/feed.xml" title="${esc(brand ? brand.name : PRODUCT.name)} status"><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head><body>
${brand ? `<header><div class="in"><a class="brand" href="${esc(brand.home)}">${esc(brand.name)}</a><nav><a href="${esc(base)}">Status</a><a href="${esc(brand.home)}">Help center</a></nav></div></header>` : `<header><div class="in"><a class="brand" href="/">Eff<span>Desk</span></a><nav><a href="/status">Status</a><a href="/app.html">Sign in</a></nav></div></header>`}
<main class="doc status">${body}</main><footer><div class="in"><span class="m">${brand ? 'Powered by ' + esc(PRODUCT.name) : esc(PRODUCT.name)}</span></div></footer><script src="/js/i18n.js"></script></body></html>`;
}
export function renderJson(d, name = PRODUCT.name) {
  const ind = { operational: 'none', maintenance: 'maintenance', degraded: 'minor', partial_outage: 'major', major_outage: 'critical' }[d.overall];
  return { page: { name, updated_at: d.generatedAt }, status: { indicator: ind, description: (BANNER[d.overall] || BANNER.operational)[0] }, components: d.components.map(c => ({ id: c.id, name: c.name, status: c.state, uptime_90d: c.uptime })), incidents: d.open.map(i => ({ id: i.id, name: i.title, status: i.status, impact: i.impact, started_at: i.started_at, updates: i.updates.map(u => ({ status: u.status, body: u.body, at: u.created_at })) })), scheduled_maintenances: d.maintenance.map(i => ({ id: i.id, name: i.title, status: i.status, scheduled_for: i.scheduled_for, scheduled_until: i.scheduled_until })) };
}
export function renderFeed(d, origin, { path = '/status', name = PRODUCT.name } = {}) {
  const items = [...d.open, ...d.maintenance, ...d.past].flatMap(i => i.updates.map(u => ({ i, u }))).sort((a, b) => new Date(b.u.created_at) - new Date(a.u.created_at)).slice(0, 50);
  const x = v => esc(v);
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>${x(name)} status</title><id>${x(origin)}${x(path)}</id><link href="${x(origin)}${x(path)}"/><link rel="self" href="${x(origin)}${x(path)}/feed.xml"/><updated>${x(d.generatedAt)}</updated>${items.map(({ i, u }) => `<entry><title>${x(i.title)} (${x(STATUS_NAME[u.status] || u.status)})</title><id>${x(origin)}${x(path)}/incidents/${i.id}#u${u.id}</id><link href="${x(origin)}${x(path)}/incidents/${i.id}"/><updated>${x(new Date(u.created_at).toISOString())}</updated><content type="text">${x(u.body)}</content></entry>`).join('')}</feed>`;
}
