// src/platform-settings.js: SITE-WIDE SETTINGS the platform owner controls: the announcement banner shown inside every desk, and whether new workspaces can sign up. Read often (every desk load), so kept in memory for 30 seconds.
const DEFAULTS = { announcement: { active: false, text: '', tone: 'info', link: '' }, signups: { open: true, message: '' } };
let cache = null, at = 0;
const clean = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
export async function settings(pool, now = Date.now()) {
  if (cache && now - at < 30000) return cache;
  const out = { announcement: { ...DEFAULTS.announcement }, signups: { ...DEFAULTS.signups } };
  try { for (const r of (await pool.query('select key, value from platform_settings')).rows) if (out[r.key]) Object.assign(out[r.key], r.value); } catch { /* before the migration has run, the defaults apply */ }
  cache = out; at = now; return out;
}
export const resetCache = () => { cache = null; };
export function cleanSetting(key, v) {
  v = v || {};
  if (key === 'announcement') { const link = clean(v.link, 300); return { active: v.active === true, text: clean(v.text, 280), tone: ['info', 'warn', 'danger'].includes(v.tone) ? v.tone : 'info', link: /^https:\/\//.test(link) ? link : '' }; }
  if (key === 'signups') return { open: v.open !== false, message: clean(v.message, 200) };
  return null;
}
export async function saveSetting(pool, key, value, actor) {
  const v = cleanSetting(key, value); if (!v) return { ok: false, status: 400, error: 'Unknown setting.' };
  if (key === 'announcement' && v.active && !v.text) return { ok: false, status: 400, error: 'Write the announcement text, or switch it off.' };
  await pool.query('insert into platform_settings (key, value, updated_by) values ($1,$2,$3) on conflict (key) do update set value = $2, updated_at = now(), updated_by = $3', [key, JSON.stringify(v), clean(actor, 120)]);
  resetCache(); return { ok: true, value: v };
}
// what a desk shows: the banner only when it is on
export const publicBanner = s => s.announcement.active && s.announcement.text ? { text: s.announcement.text, tone: s.announcement.tone, link: s.announcement.link } : null;
