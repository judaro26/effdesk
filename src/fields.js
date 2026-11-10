// src/fields.js: CUSTOM TICKET FIELDS. An organization defines up to 20 extra fields (text, number, dropdown, yes/no, date) that agents fill in on a ticket: order number, product, plan, due date.
// Values live in tickets.custom (json, keyed by the field's key). Only keys that are defined count; a value that does not fit its field is refused, an empty value clears it.
import { withOrg } from './db.js';
export const TYPES = ['text', 'number', 'dropdown', 'checkbox', 'date'];
export const MAX_FIELDS = 20;
const slug = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
export async function listFields(pool, orgId) { return withOrg(pool, orgId, async c => ({ ok: true, types: TYPES, fields: (await c.query('select id, key, label, type, options from custom_fields where org_id = $1 order by position, id', [orgId])).rows })); }
export async function saveField(pool, orgId, b) {
  const label = String(b.label || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60), type = String(b.type || ''); if (!label) return { ok: false, status: 400, error: 'Give the field a name.' }; if (!TYPES.includes(type)) return { ok: false, status: 400, error: 'Choose a field type.' };
  let options = []; if (type === 'dropdown') { options = [...new Set((Array.isArray(b.options) ? b.options : String(b.options || '').split(/\r?\n|,/)).map(x => String(x).replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60)).filter(Boolean))].slice(0, 30); if (!options.length) return { ok: false, status: 400, error: 'A dropdown needs at least one choice.' }; }
  return withOrg(pool, orgId, async c => {
    if (b.id) { const r = await c.query('update custom_fields set label = $3, options = $4 where org_id = $1 and id = $2 returning id', [orgId, Number(b.id) || 0, label, options]); return r.rowCount ? { ok: true, id: r.rows[0].id } : { ok: false, status: 404, error: 'No such field.' }; }       // the type and key never change once made
    const have = (await c.query('select key from custom_fields where org_id = $1', [orgId])).rows.map(r => r.key); if (have.length >= MAX_FIELDS) return { ok: false, status: 400, error: `You can have up to ${MAX_FIELDS} fields.` };
    let key = slug(label) || 'field', k = key, i = 2; while (have.includes(k)) k = key + '_' + i++;
    return { ok: true, id: (await c.query('insert into custom_fields (org_id, key, label, type, options, position) values ($1,$2,$3,$4,$5,(select coalesce(max(position),0)+1 from custom_fields where org_id = $1)) returning id', [orgId, k, label, type, options])).rows[0].id, key: k };
  });
}
export const deleteField = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from custom_fields where org_id = $1 and id = $2', [orgId, Number(id) || 0])).rowCount > 0);
// input { key: value } -> { set: { key: value }, clear: [keys], error }
export function cleanValues(defs, input) {
  const set = {}, clear = [];
  for (const [key, raw] of Object.entries(input && typeof input === 'object' ? input : {})) {
    const d = defs.find(x => x.key === key); if (!d) continue;
    if (raw === null || raw === '' || raw === undefined) { clear.push(key); continue; }
    if (d.type === 'text') set[key] = String(raw).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 500);
    else if (d.type === 'number') { const n = Number(raw); if (!Number.isFinite(n) || Math.abs(n) > 1e12) return { error: `${d.label} must be a number.` }; set[key] = n; }
    else if (d.type === 'dropdown') { if (!d.options.includes(String(raw))) return { error: `${d.label}: choose one of the listed options.` }; set[key] = String(raw); }
    else if (d.type === 'checkbox') set[key] = raw === true || raw === 'true' || raw === 'yes';
    else if (d.type === 'date') { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw)) || Number.isNaN(Date.parse(raw))) return { error: `${d.label} must be a date like 2026-11-30.` }; set[key] = String(raw); }
  }
  return { set, clear };
}
export const defsOf = async (c, orgId) => (await c.query('select key, label, type, options from custom_fields where org_id = $1', [orgId])).rows;
