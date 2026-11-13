// src/requests.js: REQUEST FORMS. A customer opens a ticket from the help center (/help/<workspace>/requests/new) without signing in.
//   A workspace always has the plain "Submit a request" form. On plans with request forms the admins add their own: each sets the queue, type, priority and labels, and which extra ticket fields the customer fills in.
//   Spam: a hidden field only bots fill in, a signed timestamp (the form must have been open for a few seconds, and not for days), and limits per email address and per workspace per hour.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { createTicket, TYPES } from './tickets.js';
import { cleanValues, defsOf } from './fields.js';
import { emit } from './webhooks.js';
import { notifyTicket } from './notify.js';
import { normalizeApprovalConfig, validateApprovalConfig, createForTicket } from './approvals.js';

const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400, extra = {}) => ({ ok: false, status, error, ...extra });
const PRIOS = ['low', 'normal', 'high', 'urgent'];
const secret = env => String(env.EMAIL_TOKEN_SECRET || env.BETTER_AUTH_SECRET || '');
export const formToken = (env, orgId, ts) => crypto.createHmac('sha256', secret(env)).update(`reqform:${orgId}:${ts}`).digest('hex').slice(0, 24);
export const newToken = (env, orgId, now = Date.now()) => `${now}.${formToken(env, orgId, now)}`;
const tokenState = (env, orgId, tok, now) => {
  const [ts, sig] = String(tok || '').split('.'), t = Number(ts); if (!t || !sig || !secret(env)) return 'bad';
  const a = Buffer.from(formToken(env, orgId, t)), b = Buffer.from(sig); if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'bad';
  if (now - t < 3000) return 'fast'; if (now - t > 2 * 3600 * 1000) return 'old'; return 'ok';
};
export const PER_EMAIL_HOUR = 5, PER_ORG_HOUR = 100;
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const formCols = 'id, name, description, subject_hint, queue_id, type, priority, tags, field_keys, active, position, approval_config';

// ---- the admins' side ----
export async function listForms(pool, orgId) {
  return withOrg(pool, orgId, async c => ({ ok: true, forms: (await c.query(`select ${formCols}, (select count(*)::int from tickets t where t.form_id = request_forms.id) as tickets from request_forms where org_id = $1 order by position, id`, [orgId])).rows }));
}
export async function saveForm(pool, orgId, b) {
  const name = clean(b.name, 60); if (!name) return fail('Give the form a name.');
  const type = TYPES.includes(b.type) ? b.type : 'question', priority = PRIOS.includes(b.priority) ? b.priority : 'normal';
  const tags = [...new Set((Array.isArray(b.tags) ? b.tags : String(b.tags || '').split(',')).map(t => clean(t, 30).toLowerCase().replace(/\s+/g, '-')).filter(Boolean))].slice(0, 10);
  try {
    return await withOrg(pool, orgId, async c => {
      const defs = (await defsOf(c, orgId)).map(d => d.key), keys = [...new Set((Array.isArray(b.fieldKeys) ? b.fieldKeys : []).map(String))].filter(k => defs.includes(k));
      let queue = null; if (/^\d{1,12}$/.test(String(b.queueId || ''))) { queue = (await c.query('select id from queues where org_id = $1 and id = $2', [orgId, Number(b.queueId)])).rows[0]?.id || null; }
      const approvalConfig = normalizeApprovalConfig(b.approvalConfig);
      const validApproval = await validateApprovalConfig(c, orgId, approvalConfig);
      if (!validApproval.ok) return validApproval;
      const vals = [orgId, name, clean(b.description, 300), clean(b.subjectHint, 100), queue, type, priority, tags, keys, b.active !== false, JSON.stringify(validApproval.config)];
      if (b.id) { const u = await c.query('update request_forms set name = $2, description = $3, subject_hint = $4, queue_id = $5, type = $6, priority = $7, tags = $8, field_keys = $9, active = $10, approval_config = $11 where org_id = $1 and id = $12 returning id', [...vals, Number(b.id)]); if (!u.rowCount) return fail('No such form.', 404); return { ok: true, id: u.rows[0].id }; }
      if ((await c.query('select count(*)::int n from request_forms where org_id = $1', [orgId])).rows[0].n >= 20) return fail('You can have up to 20 request forms.');
      return { ok: true, id: (await c.query('insert into request_forms (org_id, name, description, subject_hint, queue_id, type, priority, tags, field_keys, active, approval_config) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id', vals)).rows[0].id };
    });
  } catch (e) { if (e.code === '23505') return fail('A form with that name already exists.'); throw e; }
}
export const deleteForm = async (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from request_forms where org_id = $1 and id = $2', [orgId, Number(id)])).rowCount > 0);

// ---- the customer's side ----
// the forms a customer may pick from (only when the plan has request forms), each with the extra fields it asks for
export async function publicForms(pool, orgId, { custom = false, fields = false } = {}) {
  if (!custom) return [];
  return withOrg(pool, orgId, async c => {
    const forms = (await c.query(`select ${formCols} from request_forms where org_id = $1 and active order by position, id`, [orgId])).rows;
    if (!fields) return forms;
    const defs = (await c.query('select key, label, type, options from custom_fields where org_id = $1 order by position, id', [orgId])).rows;
    return forms.map(f => ({ ...f, fields: f.field_keys.map(k => defs.find(d => d.key === k)).filter(Boolean) }));
  });
}
export async function submit(pool, env, org, input, { mailer, custom = false, fields = false, now = Date.now() } = {}) {
  if (clean(input.website, 100)) return fail('Thank you.', 200, { silent: true });                   // the hidden field: a bot filled it in; pretend it worked
  const st = tokenState(env, org.id, input.ts, now);
  if (st === 'bad') return fail('This form expired. Reload the page and try again.', 400, { retry: true });
  if (st === 'old') return fail('This form was open too long. Reload the page and try again.', 400, { retry: true });
  if (st === 'fast') return fail('That was quick. Wait a moment and send again.', 429, { retry: true });
  const email = clean(input.email, 254).toLowerCase(), name = clean(input.name, 100), subject = clean(input.subject, 200), body = clean(input.description, 5000);
  if (!isEmail(email)) return fail('Enter a valid email address so we can reply.', 400, { field: 'email' });
  if (!subject) return fail('Give your request a subject.', 400, { field: 'subject' });
  if (!body) return fail('Describe what you need.', 400, { field: 'description' });
  let form = null;
  if (custom && /^\d{1,12}$/.test(String(input.form || ''))) { form = (await publicForms(pool, org.id, { custom, fields: true })).find(f => String(f.id) === String(input.form)) || null; if (!form) return fail('That form is not available.', 404); }
  const recent = await withOrg(pool, org.id, async c => (await c.query(`select count(*) filter (where requester_email = $2)::int as mine, count(*)::int as everyone from tickets where org_id = $1 and via_portal and created_at > now() - interval '1 hour'`, [org.id, email])).rows[0]);
  if (recent.mine >= PER_EMAIL_HOUR || recent.everyone >= PER_ORG_HOUR) return fail('We have received a lot of requests from you. Please wait a while, we will reply to the ones we have.', 429);
  const cf = {}; if (form && fields) for (const f of form.fields || []) { const v = input['cf_' + f.key]; if (v !== undefined && v !== '') cf[f.key] = f.type === 'checkbox' ? v === 'on' || v === 'true' || v === true : v; }
  const r = await createTicket(pool, org.id, null, { subject, body, requesterEmail: email, requesterName: name, channel: 'web', tags: form ? form.tags : [], custom: cf, priority: form ? form.priority : 'normal' });
  if (!r.ok) return r;
  await withOrg(pool, org.id, c => c.query('update tickets set via_portal = true, form_id = $3, queue_id = coalesce($4, queue_id), type = $5 where org_id = $1 and id = $2', [org.id, r.ticket.id, form ? form.id : null, form ? form.queue_id : null, form ? form.type : 'question']));
  if (form) { try { await createForTicket(pool, org.id, r.ticket, form.id, null); } catch (e) { console.warn('request approval creation failed:', e.message); } }
  await emit(pool, org.id, 'ticket.created', r.ticket.number);
  if (mailer) { try { await notifyTicket(pool, mailer, org.id, r.ticket.number, { kind: 'reply', summary: body }); } catch { } }
  return { ok: true, number: r.ticket.number };
}
