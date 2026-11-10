// src/triggers.js: TRIGGERS AND AUTOMATIONS. A rule is "when <event>, if <all conditions>, do <actions>".
//   Events: created (a new ticket), customer_reply (the customer wrote again), time (checked every hour: for tickets that have sat idle, such as "solved for 7 days -> closed").
//   Conditions (all must hold): priority / status / channel / type  is, is_not;  tag  is, is_not;  subject / message  contains;  sender_domain  is;  hours_idle  gte (time rules).
//   Actions, in order: set_priority, set_status, set_type, add_tag, assign (an agent id, or "none"), set_queue, add_note (internal), auto_reply (public, {{name}} is the requester's first name).
//   Rules run only on these events and their actions do not start other rules, so they cannot loop. "once" (the default) means a rule runs one time per ticket.
import { withOrg } from './db.js';
import { updateTicket, addMessage } from './tickets.js';
import { sendTicketReply } from './ticket-mail.js';
export const EVENTS = ['created', 'customer_reply', 'time'];
const ENUM = { priority: ['low', 'normal', 'high', 'urgent'], status: ['open', 'pending', 'solved', 'closed'], channel: ['web', 'email', 'api', 'portal', 'chat'], type: ['question', 'incident', 'problem', 'task'] };
export const FIELDS = { priority: ['is', 'is_not'], status: ['is', 'is_not'], channel: ['is', 'is_not'], type: ['is', 'is_not'], tag: ['is', 'is_not'], subject: ['contains'], message: ['contains'], sender_domain: ['is'], hours_idle: ['gte'] };
export const ACTIONS = ['set_priority', 'set_status', 'set_type', 'add_tag', 'assign', 'set_queue', 'add_note', 'auto_reply'];
export const MAX_RULES = 25;
const clean = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, n);
export function normalize(b) {
  const name = clean(b.name, 80), event = String(b.event || ''); if (!name) return { error: 'Give the rule a name.' }; if (!EVENTS.includes(event)) return { error: 'Choose when the rule runs.' };
  const conditions = []; for (const c of (Array.isArray(b.conditions) ? b.conditions : []).slice(0, 8)) {
    const field = String(c.field || ''), op = String(c.op || ''); if (!FIELDS[field] || !FIELDS[field].includes(op)) return { error: 'One of the conditions is not valid.' };
    let value = clean(c.value, 200).toLowerCase(); if (!value) return { error: 'Fill in every condition.' };
    if (ENUM[field] && !ENUM[field].includes(value)) return { error: `"${value}" is not a ${field}.` };
    if (field === 'hours_idle') { value = String(Math.min(Math.max(parseInt(value, 10) || 0, 1), 24 * 365)); } conditions.push({ field, op, value });
  }
  if (event === 'time' && !conditions.some(c => c.field === 'hours_idle')) return { error: 'A timed rule needs an "hours idle" condition.' };
  const actions = []; for (const a of (Array.isArray(b.actions) ? b.actions : []).slice(0, 6)) {
    const type = String(a.type || ''); if (!ACTIONS.includes(type)) return { error: 'One of the actions is not valid.' };
    let value = clean(type === 'add_note' || type === 'auto_reply' ? a.value : String(a.value || '').toLowerCase(), type === 'add_note' || type === 'auto_reply' ? 2000 : 80); if (!value) return { error: 'Fill in every action.' };
    if (type === 'set_priority' && !ENUM.priority.includes(value)) return { error: 'That priority does not exist.' }; if (type === 'set_status' && !ENUM.status.includes(value)) return { error: 'That status does not exist.' }; if (type === 'set_type' && !ENUM.type.includes(value)) return { error: 'That type does not exist.' };
    if (type === 'assign') value = clean(a.value, 80); actions.push({ type, value });
  }
  if (!actions.length) return { error: 'Add at least one action.' };
  return { rule: { name, event, conditions, actions, once: b.once !== false, active: b.active !== false } };
}
export async function listRules(pool, orgId) { return withOrg(pool, orgId, async c => ({ ok: true, rules: (await c.query('select id, name, event, conditions, actions, once, active from triggers where org_id = $1 order by position, id', [orgId])).rows })); }
export async function saveRule(pool, orgId, b) {
  const n = normalize(b); if (n.error) return { ok: false, status: 400, error: n.error }; const r = n.rule;
  return withOrg(pool, orgId, async c => {
    if (b.id) { const u = await c.query('update triggers set name=$3, event=$4, conditions=$5, actions=$6, once=$7, active=$8 where org_id=$1 and id=$2 returning id', [orgId, Number(b.id) || 0, r.name, r.event, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.once, r.active]); return u.rowCount ? { ok: true, id: u.rows[0].id } : { ok: false, status: 404, error: 'No such rule.' }; }
    if ((await c.query('select count(*)::int n from triggers where org_id = $1', [orgId])).rows[0].n >= MAX_RULES) return { ok: false, status: 400, error: `You can have up to ${MAX_RULES} rules.` };
    return { ok: true, id: (await c.query('insert into triggers (org_id, name, event, conditions, actions, once, active, position) values ($1,$2,$3,$4,$5,$6,$7,(select coalesce(max(position),0)+1 from triggers where org_id = $1)) returning id', [orgId, r.name, r.event, JSON.stringify(r.conditions), JSON.stringify(r.actions), r.once, r.active])).rows[0].id };
  });
}
export const deleteRule = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from triggers where org_id = $1 and id = $2', [orgId, Number(id) || 0])).rowCount > 0);
// does the ticket (t) with its latest customer message (msg) satisfy every condition?
export function matches(conditions, t, msg = '', nowMs = Date.now()) {
  return conditions.every(c => {
    const v = String(c.value);
    switch (c.field) {
      case 'priority': case 'status': case 'channel': case 'type': return (String(t[c.field]) === v) === (c.op === 'is');
      case 'tag': return ((t.tags || []).map(x => String(x).toLowerCase()).includes(v)) === (c.op === 'is');
      case 'subject': return String(t.subject || '').toLowerCase().includes(v);
      case 'message': return String(msg || '').toLowerCase().includes(v);
      case 'sender_domain': return String(t.requester_email || '').toLowerCase().split('@')[1] === v;
      case 'hours_idle': return (nowMs - new Date(t.updated_at).getTime()) / 3600000 >= Number(v);
      default: return false;
    }
  });
}
const TCOLS = 'id, number, subject, status, priority, channel, type, tags, requester_email, requester_name, updated_at';
async function apply(pool, mailer, env, orgId, rule, t) {
  const actor = { id: null, name: 'Automation: ' + rule.name, email: '' };
  for (const a of rule.actions) {
    if (a.type === 'add_tag') { const tags = [...new Set([...(t.tags || []), a.value.toLowerCase()])]; const r = await updateTicket(pool, orgId, actor, t.number, { tags }); if (r.ok) t.tags = r.ticket.tags; }
    else if (a.type === 'set_priority' || a.type === 'set_status' || a.type === 'set_type' || a.type === 'assign' || a.type === 'set_queue') {
      const patch = a.type === 'set_priority' ? { priority: a.value } : a.type === 'set_status' ? { status: a.value } : a.type === 'set_type' ? { type: a.value } : a.type === 'assign' ? { assigneeId: a.value === 'none' ? null : a.value } : { queueId: a.value === 'none' ? null : a.value };
      const r = await updateTicket(pool, orgId, actor, t.number, patch); if (r.ok) Object.assign(t, { priority: r.ticket.priority, status: r.ticket.status, type: r.ticket.type });
    } else if (a.type === 'add_note') await addMessage(pool, orgId, actor, t.number, { body: a.value, internal: true });
    else if (a.type === 'auto_reply') {
      const first = String(t.requester_name || '').split(' ')[0] || 'there', r = await addMessage(pool, orgId, actor, t.number, { body: a.value.replace(/\{\{\s*name\s*\}\}/g, first), internal: false });
      if (r.ok && mailer) await sendTicketReply(pool, mailer, env, orgId, t.number, r.message.id, []);
    }
  }
}
async function runOne(pool, mailer, env, orgId, rule, t, msg, nowMs) {
  if (!matches(rule.conditions, t, msg, nowMs)) return false;
  if (rule.once || rule.event === 'time') { const first = await withOrg(pool, orgId, async c => (await c.query('insert into trigger_runs (trigger_id, ticket_id) values ($1,$2) on conflict do nothing returning 1', [rule.id, t.id])).rowCount); if (!first) return false; }
  try { await apply(pool, mailer, env, orgId, rule, t); } catch (e) { console.warn('rule error:', rule.name, e.message); }
  return true;
}
// called after a ticket is created or the customer replies
export async function runTriggers(pool, mailer, env, orgId, event, number, msg = '', nowMs = Date.now()) {
  try {
    const { rules, t } = await withOrg(pool, orgId, async c => ({ rules: (await c.query('select id, name, event, conditions, actions, once from triggers where org_id = $1 and active and event = $2 order by position, id', [orgId, event])).rows, t: (await c.query(`select ${TCOLS} from tickets where org_id = $1 and number = $2`, [orgId, Number(number) || 0])).rows[0] }));
    if (!rules.length || !t) return { ran: 0 };
    let ran = 0; for (const r of rules) if (await runOne(pool, mailer, env, orgId, r, t, msg, nowMs)) ran++;
    return { ran };
  } catch (e) { console.warn('triggers error:', e.message); return { ran: 0 }; }
}
// the hourly pass: every organization's timed rules over its tickets that are not closed (at most 200 per organization per run)
export async function runTimed(pool, mailer, env, nowMs = Date.now()) {
  let ran = 0;
  try {
    const orgs = (await pool.query('select id from "organization"')).rows;     // row security hides rules until an organization is chosen, so each one is asked in turn
    for (const { id: orgId } of orgs) {
      const rules = (await withOrg(pool, orgId, c => c.query("select id, name, event, conditions, actions, once from triggers where org_id = $1 and active and event = 'time' order by position, id", [orgId]))).rows;
      if (!rules.length) continue;
      const tickets = (await withOrg(pool, orgId, c => c.query(`select ${TCOLS} from tickets where org_id = $1 and status <> 'closed' order by updated_at limit 200`, [orgId]))).rows;
      for (const t of tickets) for (const r of rules) if (await runOne(pool, mailer, env, orgId, r, t, '', nowMs)) ran++;
    }
  } catch (e) { console.warn('timed rules error:', e.message); }
  return { ran };
}
