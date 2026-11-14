// src/tickets.js: THE TICKET CORE. Every function runs inside withOrg (row level security) AND names org_id in its queries, so a mistake in one layer is caught by the other.
import { autoAssign } from './routing.js';
import { withOrg } from './db.js';
import { slaWhere } from './sla.js';
import { defsOf, cleanValues } from './fields.js';
import { clean as cleanHtml, plainOf } from './html-clean.js';
import { ensureContact } from './contacts.js';

export const STATUSES = ['open', 'pending', 'on_hold', 'solved', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const validDateOnly = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && !Number.isNaN(Date.parse(String(v) + 'T00:00:00Z')) && new Date(String(v) + 'T00:00:00Z').toISOString().slice(0, 10) === String(v);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
const cleanTags = t => [...new Set((Array.isArray(t) ? t : String(t || '').split(',')).map(x => clean(x, 30).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))].slice(0, 20);
const fail = (error, status = 400) => ({ ok: false, status, error });
const ticketCols = 'custom, id, number, subject, status, closed_at, custom_status_id, priority, channel, requester_name, requester_email, assignee_id, tags, first_response_at, solved_at, created_at, updated_at, type, queue_id, client_id, cc, merged_into, problem_number, lifecycle_parent_ticket_id';
export const TYPES = ['question', 'incident', 'problem', 'task'];
export const cleanText = clean, validEmail = isEmail;
// a line in the ticket's timeline (who did what); callers are already inside withOrg
export const logEvent = (c, orgId, ticketId, actorName, kind, detail = '') => c.query('insert into ticket_events (org_id, ticket_id, actor_name, kind, detail) values ($1,$2,$3,$4,$5)', [orgId, ticketId, clean(actorName, 100), kind, clean(detail, 500)]);
const who = a => (a && (a.name || a.email)) || 'Customer';

// a new ticket with its first message (from the requester, or from an agent who is logging a call)
export async function createTicket(pool, orgId, actor, input) {
  const subject = clean(input.subject, 200), safeHtml = input.htmlBody ? cleanHtml(String(input.htmlBody).slice(0, 100000), { allowCidImages: input.channel === 'email' }) : null, body = clean(input.body, 20000) || (safeHtml ? clean(plainOf(safeHtml), 20000) : ''), email = clean(input.requesterEmail, 254).toLowerCase();
  if (!subject) return fail('Give the ticket a subject.');
  if (!body) return fail('Write the first message.');
  if (!isEmail(email)) return fail('Enter the requester\'s email address.');
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'normal';
  const kind = actor && (input.firstKind === 'agent' || input.firstKind === 'note') ? input.firstKind : 'requester';   // an agent can open a ticket with a public reply or a note
  return withOrg(pool, orgId, async c => {
    let lifecycleParentId = null;
    if (input.lifecycleParentTicketNumber !== undefined && input.lifecycleParentTicketNumber !== null) {
      const parent = (await c.query('select id,status,closed_at,subject from tickets where org_id=$1 and number=$2 for update',[orgId,Number(input.lifecycleParentTicketNumber)||0])).rows[0];
      if (!parent) return fail('The original ticket could not be found.',404);
      const cfg=(await c.query('select config from ticket_lifecycle_policies where org_id=$1',[orgId])).rows[0]?.config||{};
      const days=Number(cfg.permanentCloseDays)||30;
      if (parent.status!=='closed' || cfg.permanentCloseEnabled!==true || !parent.closed_at || Date.now()-new Date(parent.closed_at).getTime()<days*86400000) return fail('A linked follow-up can only be created from a permanently closed ticket.');
      lifecycleParentId=parent.id;
    }
    const n = (await c.query('insert into ticket_counters (org_id, last_number) values ($1, 1) on conflict (org_id) do update set last_number = ticket_counters.last_number + 1 returning last_number', [orgId])).rows[0].last_number;
    let custom = {}; if (input.custom && Object.keys(input.custom).length) { const cv = cleanValues(await defsOf(c, orgId), input.custom); if (cv.error) return fail(cv.error); custom = cv.set; }
    const domain = email.split('@')[1], client = (await c.query("select id from clients where org_id = $1 and domain <> '' and domain = $2 order by id limit 1", [orgId, domain])).rows[0];
    const t = (await c.query(`insert into tickets (org_id, number, subject, priority, channel, requester_name, requester_email, tags, client_id, custom, lifecycle_parent_ticket_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning ${ticketCols}`, [orgId, n, subject, priority, input.channel === 'email' || input.channel === 'api' || input.channel === 'chat' || input.channel === 'whatsapp' ? input.channel : 'web', clean(input.requesterName, 100), email, cleanTags(input.tags), client ? client.id : null, JSON.stringify(custom), lifecycleParentId])).rows[0];
    await ensureContact(c, orgId, { email, name: clean(input.requesterName, 100), companyId: client ? client.id : null });
    await logEvent(c, orgId, t.id, actor ? who(actor) : clean(input.requesterName, 100) || email, 'created', 'Ticket created' + (input.channel === 'email' ? ' by email' : ''));
    const mid = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_id, author_name, body, message_id, html_body) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id', [orgId, t.id, kind, kind === 'requester' ? null : actor.id, kind === 'requester' ? clean(input.requesterName, 100) || email : who(actor), body, input.messageId ? clean(input.messageId, 300) : null, safeHtml || null])).rows[0].id;
    if ((!actor || input.channel === 'api') && input.route !== false) { const a = await autoAssign(c, orgId, t.id); if (a) { t.assignee_id = a.id; await logEvent(c, orgId, t.id, 'Routing', 'assigned', 'Assigned to ' + a.name + ' automatically'); } }
    if (kind === 'agent') { await c.query('update tickets set first_response_at = now() where id = $1', [t.id]); t.first_response_at = new Date().toISOString(); }
    return { ok: true, ticket: t, messageRowId: mid };
  });
}

// the list: filter by status, assignee ("me", "none" or a user id), a text search and one tag; newest activity first; paged
export async function listTickets(pool, orgId, actor, q = {}) {
  const where = ['org_id = $1'], args = [orgId], add = (sql, v) => { args.push(v); where.push(sql.replace('$#', '$' + args.length)); };
  if (STATUSES.includes(q.status)) add('status = $#', q.status);
  if (/^\d{1,12}$/.test(String(q.cstatus || ''))) add('custom_status_id = $#', Number(q.cstatus));
  else if (q.status === 'active') where.push("status in ('open','pending','on_hold')");
  if (q.assignee === 'me') add('assignee_id = $#', actor.id); else if (q.assignee === 'none') where.push('assignee_id is null'); else if (q.assignee) add('assignee_id = $#', clean(q.assignee, 64));
  if (q.tag) add('$# = any(tags)', clean(q.tag, 30).toLowerCase());
  if (q.queue === 'none') where.push('queue_id is null'); else if (/^\d{1,12}$/.test(String(q.queue || ''))) add('queue_id = $#', Number(q.queue));
  if (TYPES.includes(q.type)) add('type = $#', q.type);
  if (/^\d{1,12}$/.test(String(q.client || ''))) add('client_id = $#', Number(q.client));
  if (/^\d{1,9}$/.test(String(q.problem || ''))) add('problem_number = $#', Number(q.problem));
  if (Array.isArray(q.numbers)) add('number = any($#)', q.numbers.map(Number).filter(Number.isInteger)); else { const sw = slaWhere(q.sla); if (sw) where.push(sw); }
  if (q.following === 'me') add('id in (select ticket_id from ticket_followers where org_id = $1 and user_id = $#)', actor.id);
  const cf = q.columnFilters && typeof q.columnFilters === 'object' && !Array.isArray(q.columnFilters) ? q.columnFilters : {};
  if (STATUSES.includes(cf.status)) add('status = $#', cf.status);
  if (/^\d{1,9}$/.test(String(cf.number || ''))) add('number = $#', Number(cf.number));
  if (cf.subject) add('subject ilike $#', '%' + clean(cf.subject, 100).replace(/[\%_]/g, m => '\\' + m) + '%');
  if (cf.requester) { const term = '%' + clean(cf.requester, 100).replace(/[\%_]/g, m => '\\' + m) + '%'; args.push(term); const i = args.length; where.push('(requester_name ilike $' + i + ' or requester_email ilike $' + i + ')'); }
  if (PRIORITIES.includes(cf.priority)) add('priority = $#', cf.priority);
  if (cf.assignee === 'me') add('assignee_id = $#', actor.id);
  else if (cf.assignee === 'none') where.push('assignee_id is null');
  else if (/^[A-Za-z0-9_-]{1,64}$/.test(String(cf.assignee || ''))) add('assignee_id = $#', String(cf.assignee));
  if (validDateOnly(cf.updatedFrom)) add('updated_at >= $#::date', cf.updatedFrom);
  if (validDateOnly(cf.updatedTo)) add("updated_at < ($#::date + interval '1 day')", cf.updatedTo);
  const cSla = slaWhere(cf.sla); if (cSla) where.push(cSla);
  const text = clean(q.q, 100);
  if (text) { const like = '%' + text.replace(/[\\%_]/g, m => '\\' + m) + '%'; args.push(like); const i = args.length; where.push(`(subject ilike $${i} or requester_email ilike $${i} or requester_name ilike $${i} or (case when $${i + 1}::int is null then false else number = $${i + 1}::int end))`); args.push(/^#?\d{1,9}$/.test(text) ? Number(text.replace('#', '')) : null); }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 100), offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return withOrg(pool, orgId, async c => {
    // Fetch the page and tenant-wide status totals in one database round trip.
    // The counts CTE always returns one row, including when the requested page is empty.
    const result = await c.query(`
      with ticket_counts as (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) as by_status
        from (select status, count(*)::int as n from tickets where org_id = $1 group by status) totals
      ), ticket_page as (
        select ${ticketCols} from tickets
        where ${where.join(' and ')}
        order by updated_at desc, id desc
        limit ${limit} offset ${offset}
      )
      select ticket_page.*, ticket_counts.by_status as "__counts"
      from ticket_counts left join ticket_page on true
    `, args);
    const first = result.rows[0];
    const counts = first && first.__counts || {};
    const rows = result.rows.filter(row => row.id !== null).map(({ __counts, ...ticket }) => ticket);
    return { ok: true, tickets: rows, counts: { open: 0, pending: 0, on_hold: 0, solved: 0, closed: 0, ...counts } };
  });
}

export async function getTicket(pool, orgId, actor, number) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query(`select ${ticketCols} from tickets where org_id = $1 and number = $2`, [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    const messages = (await c.query('select id, kind, author_id, author_name, body, html_body, created_at, edited_at from ticket_messages where org_id = $1 and ticket_id = $2 order by created_at, id', [orgId, t.id])).rows;
    const files = (await c.query('select id, message_id, filename, content_type, size from attachments where org_id = $1 and ticket_id = $2 and message_id is not null and is_inline = false order by created_at', [orgId, t.id])).rows;
    const lifecycleParent = t.lifecycle_parent_ticket_id ? (await c.query('select number,subject from tickets where org_id=$1 and id=$2',[orgId,t.lifecycle_parent_ticket_id])).rows[0] || null : null;
    const lifecycleFollowUps = (await c.query('select number,subject,status from tickets where org_id=$1 and lifecycle_parent_ticket_id=$2 order by created_at',[orgId,t.id])).rows;
    // Group once rather than scanning every attachment for every message (O(messages + files)).
    const attachmentsByMessage = new Map();
    for (const file of files) {
      if (!attachmentsByMessage.has(file.message_id)) attachmentsByMessage.set(file.message_id, []);
      attachmentsByMessage.get(file.message_id).push({ id: file.id, filename: file.filename, contentType: file.content_type, size: file.size });
    }
    for (const m of messages) {
      // Older automations or integrations may have stored HTML markup in body before html_body existed.
      if (!m.html_body && /<\s*(?:p|div|table|h[1-6]|ul|ol|li|strong|b|br|a|span|blockquote|img)\b/i.test(String(m.body || ''))) {
        const safe = cleanHtml(String(m.body).slice(0, 100000));
        if (safe && /<\/?[a-z][^>]*>/i.test(safe)) { m.html_body = safe; m.body = plainOf(safe) || m.body; }
      }
      m.attachments = attachmentsByMessage.get(m.id) || [];
    }
    const policy=(await c.query('select config from ticket_lifecycle_policies where org_id=$1',[orgId])).rows[0]?.config||{};
    t.permanently_closed = t.status==='closed' && policy.permanentCloseEnabled===true && !!t.closed_at && Date.now()-new Date(t.closed_at).getTime()>=(Number(policy.permanentCloseDays)||30)*86400000;
    return { ok: true, ticket: t, messages, lifecycleLinks: { parent: lifecycleParent, followUps: lifecycleFollowUps } };
  });
}

// a public reply (kind agent) or an internal note; a public reply by an agent is the first response, and moves an open ticket to pending
export async function addMessage(pool, orgId, actor, number, { body, htmlBody, internal, status, idempotencyKey }) {
  const safeHtml = !internal && htmlBody ? cleanHtml(String(htmlBody).slice(0, 100000)) : htmlBody ? cleanHtml(String(htmlBody).slice(0, 100000)) : null;
  const text = clean(body, 20000) || (safeHtml ? clean(plainOf(safeHtml), 20000) : ''); if (!text) return fail('Write a message first.');
  if (status && !STATUSES.includes(status)) return fail('That status does not exist.');
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, status, closed_at, first_response_at from tickets where org_id = $1 and number = $2 for update', [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    if (!internal && t.status === 'closed') { const cfg=(await c.query('select config from ticket_lifecycle_policies where org_id=$1',[orgId])).rows[0]?.config||{}; if(cfg.permanentCloseEnabled===true && t.closed_at && Date.now()-new Date(t.closed_at).getTime()>=(Number(cfg.permanentCloseDays)||30)*86400000)return fail('This ticket is permanently closed. Create a linked follow-up ticket instead.',409); }
    const kind = internal ? 'note' : 'agent';
    const requestId = !internal && /^[a-f0-9-]{20,80}$/i.test(String(idempotencyKey || '')) ? 'effdesk-agent:' + String(idempotencyKey) : null;
    if (requestId) { const prior = (await c.query('select id, kind, author_id, author_name, body, html_body, created_at from ticket_messages where org_id=$1 and message_id=$2 limit 1',[orgId,requestId])).rows[0]; if (prior) return { ok:true, duplicate:true, message:prior, status:t.status }; }
    const m = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_id, author_name, body, message_id, html_body) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, kind, author_id, author_name, body, html_body, created_at', [orgId, t.id, kind, actor.id, clean(actor.name, 100) || actor.email, text, requestId, safeHtml])).rows[0];
    const next = status || (!internal && t.status === 'open' ? 'pending' : t.status);
    await c.query(`update tickets set status = $3, first_response_at = coalesce(first_response_at, case when $4 then now() end), solved_at = case when $3 in ('solved','closed') then coalesce(solved_at, now()) else null end, closed_at = case when $3 = 'closed' then coalesce(closed_at, now()) else null end, updated_at = now() where org_id = $1 and id = $2`, [orgId, t.id, next, !internal]);
    await logEvent(c, orgId, t.id, who(actor), internal ? 'note' : 'reply', internal ? 'Internal note added' : 'Public reply' + (next !== t.status ? ` · status ${t.status} → ${next}` : ''));
    return { ok: true, message: m, status: next };
  });
}

// status, priority, assignee (an organization member or null), tags, type, queue, client and CC; every change is written to the ticket's timeline
export async function updateTicket(pool, orgId, actor, number, patch) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, status, closed_at, custom_status_id, priority, assignee_id, type, queue_id, client_id, tags, cc, requester_email, custom from tickets where org_id = $1 and number = $2 for update', [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    const sets = [], args = [orgId, t.id], notes = [], set = (col, v) => { args.push(v); sets.push(col + ' = $' + args.length); };
    let label = null, cs = null;
    if (patch.customStatusId !== undefined && patch.customStatusId !== null && patch.customStatusId !== '') {
      cs = (await c.query('select id, name, category from ticket_statuses where org_id = $1 and id = $2', [orgId, Number(patch.customStatusId) || 0])).rows[0]; if (!cs) return fail('That status does not exist.');
      patch = { ...patch, status: cs.category }; label = cs.name; set('custom_status_id', cs.id);
    } else if (patch.status !== undefined && t.custom_status_id) set('custom_status_id', null);
    if (patch.status && patch.status !== 'closed' && t.status === 'closed') {
      const cfg = (await c.query('select config from ticket_lifecycle_policies where org_id=$1', [orgId])).rows[0]?.config || {};
      if (cfg.permanentCloseEnabled === true && t.closed_at && Date.now() - new Date(t.closed_at).getTime() >= (Number(cfg.permanentCloseDays) || 30) * 86400000) return fail('This ticket is permanently closed. Create a linked follow-up ticket instead.', 409);
    }
    if (patch.status !== undefined) { if (!STATUSES.includes(patch.status)) return fail('That status does not exist.'); set('status', patch.status); const statusParam = '$' + args.length; sets.push('solved_at = case when ' + statusParam + " in ('solved','closed') then coalesce(solved_at, now()) else null end"); sets.push('closed_at = case when ' + statusParam + " = 'closed' then coalesce(closed_at, now()) when " + statusParam + " <> 'closed' then null else closed_at end"); if (patch.status !== t.status || (cs && String(cs.id) !== String(t.custom_status_id))) notes.push(['status', `Status ${t.status} → ${label || patch.status}`]); }
    if (patch.priority !== undefined) { if (!PRIORITIES.includes(patch.priority)) return fail('That priority does not exist.'); set('priority', patch.priority); if (patch.priority !== t.priority) notes.push(['priority', `Priority ${t.priority} → ${patch.priority}`]); }
    if (patch.assigneeId !== undefined) {
      if (patch.assigneeId === null || patch.assigneeId === '') { set('assignee_id', null); if (t.assignee_id) notes.push(['assignee', 'Unassigned']); }
      else { const m = (await c.query('select u.name, u.email from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 and m."userId" = $2', [orgId, String(patch.assigneeId)])).rows[0]; if (!m) return fail('That person is not part of this organization.'); set('assignee_id', String(patch.assigneeId)); if (t.assignee_id !== String(patch.assigneeId)) notes.push(['assignee', 'Assigned to ' + (m.name || m.email)]); }
    }
    if (patch.tags !== undefined) { const tg = cleanTags(patch.tags); set('tags', tg); if (tg.join() !== t.tags.join()) notes.push(['tags', 'Tags: ' + (tg.join(', ') || 'none')]); }
    if (patch.type !== undefined) { if (!TYPES.includes(patch.type)) return fail('That type does not exist.'); set('type', patch.type); if (patch.type !== t.type) notes.push(['type', `Type ${t.type} → ${patch.type}`]); }
    if (patch.queueId !== undefined) {
      if (patch.queueId === null || patch.queueId === '') { set('queue_id', null); if (t.queue_id) notes.push(['queue', 'Removed from its queue']); }
      else { const q = (await c.query('select id, name from queues where org_id = $1 and id = $2', [orgId, Number(patch.queueId) || 0])).rows[0]; if (!q) return fail('That queue does not exist.'); set('queue_id', q.id); if (String(t.queue_id) !== String(q.id)) notes.push(['queue', 'Queue: ' + q.name]); }
    }
    if (patch.clientId !== undefined) {
      if (patch.clientId === null || patch.clientId === '') { set('client_id', null); if (t.client_id) notes.push(['client', 'Client removed']); }
      else { const k = (await c.query('select id, name from clients where org_id = $1 and id = $2', [orgId, Number(patch.clientId) || 0])).rows[0]; if (!k) return fail('That client does not exist.'); set('client_id', k.id); if (String(t.client_id) !== String(k.id)) notes.push(['client', 'Client: ' + k.name]); }
    }
    if (patch.cc !== undefined) {
      const list = [...new Set((Array.isArray(patch.cc) ? patch.cc : String(patch.cc || '').split(/[,;\s]+/)).map(x => clean(x, 254).toLowerCase()).filter(Boolean))];
      if (list.length > 10) return fail('A ticket can copy up to 10 people.'); if (list.some(x => !isEmail(x))) return fail('One of the CC addresses is not a valid email address.');
      const cc = list.filter(x => x !== t.requester_email); set('cc', cc); if (cc.join() !== t.cc.join()) notes.push(['cc', 'CC: ' + (cc.join(', ') || 'none')]);
    }
    if (patch.custom !== undefined) {
      const defs = await defsOf(c, orgId), cv = cleanValues(defs, patch.custom); if (cv.error) return fail(cv.error);
      const merged = { ...(t.custom || {}), ...cv.set }; for (const k of cv.clear) delete merged[k];
      for (const k of Object.keys({ ...cv.set, ...Object.fromEntries(cv.clear.map(x => [x, 1])) })) { const d = defs.find(x => x.key === k), before = (t.custom || {})[k], after = merged[k]; if (JSON.stringify(before) !== JSON.stringify(after)) notes.push(['field', `${d.label}: ${before === undefined ? 'empty' : before} → ${after === undefined ? 'empty' : after}`]); }
      set('custom', JSON.stringify(merged));
    }
    if (!sets.length) return fail('Nothing to change.');
    const row = (await c.query(`update tickets set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2 returning ${ticketCols}`, args)).rows[0];
    for (const [k, d] of notes) await logEvent(c, orgId, t.id, who(actor), k, d);
    return { ok: true, ticket: row };
  });
}

export async function listAgents(pool, orgId) {
  return (await pool.query('select u.id, u.name, u.email, u.agent_number, m.role, p.avatar from member m join "user" u on u.id = m."userId" left join desk_prefs p on p.user_id = u.id where m."organizationId" = $1 order by u.name', [orgId])).rows;
}

// ---- used by the inbound email webhook (no signed-in agent) ----
// a message from the requester: a solved or pending ticket becomes open again; a closed ticket cannot be reopened (the caller then starts a follow-up ticket)
export async function addRequesterMessage(pool, orgId, number, { body, htmlBody, authorName, messageId }) {
  const text = clean(body, 20000); if (!text) return fail('Empty message.');
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, number, subject, status, closed_at, requester_email, requester_name, client_id, channel, priority, tags from tickets where org_id = $1 and number = $2 for update', [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    await ensureContact(c, orgId, { email: t.requester_email, name: t.requester_name || authorName, companyId: t.client_id });
    const cfg = (await c.query('select config from ticket_lifecycle_policies where org_id=$1', [orgId])).rows[0]?.config || {};
    const permanentlyClosed = t.status === 'closed' && cfg.permanentCloseEnabled !== false && t.closed_at && Date.now() - new Date(t.closed_at).getTime() >= (Number(cfg.permanentCloseDays) || 30) * 86400000;
    if (permanentlyClosed) {
      const next = (await c.query('insert into ticket_counters(org_id,last_number) values($1,1) on conflict(org_id) do update set last_number=ticket_counters.last_number+1 returning last_number',[orgId])).rows[0].last_number;
      const follow = (await c.query(`insert into tickets(org_id,number,subject,priority,channel,requester_name,requester_email,tags,client_id,lifecycle_parent_ticket_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id,number`,[orgId,next,clean('Follow-up: '+t.subject,200),t.priority,t.channel,t.requester_name,t.requester_email,t.tags,t.client_id,t.id])).rows[0];
      await logEvent(c,orgId,follow.id,clean(authorName,100)||t.requester_email,'created','Follow-up to permanently closed ticket #'+t.number);
      const assigned = await autoAssign(c,orgId,follow.id); if (assigned) { await c.query('update tickets set assignee_id=$3 where org_id=$1 and id=$2',[orgId,follow.id,assigned.id]); await logEvent(c,orgId,follow.id,'Routing','assigned','Assigned to '+assigned.name+' automatically'); }
      await logEvent(c,orgId,t.id,'Ticket lifecycle automation','follow_up_created','New follow-up ticket #'+next+' created after permanent closure');
      const mid=(await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_name,body,message_id,html_body) values($1,$2,$3,$4,$5,$6,$7) returning id',[orgId,follow.id,'requester',clean(authorName,100),text,messageId?clean(messageId,300):null,String(htmlBody||'').slice(0,100000)||null])).rows[0].id;
      return { ok:true, followup:true, number:next, messageRowId:mid };
    }
    const mid = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_name, body, message_id, html_body) values ($1,$2,$3,$4,$5,$6,$7) returning id', [orgId, t.id, 'requester', clean(authorName, 100), text, messageId ? clean(messageId, 300) : null, String(htmlBody || '').slice(0, 100000) || null])).rows[0].id;
    await c.query("update tickets set status = 'open', solved_at = null, closed_at = null, updated_at = now() where org_id = $1 and id = $2", [orgId, t.id]);
    return { ok: true, reopened: t.status !== 'open', messageRowId: mid };
  });
}
export async function ticketByMessageId(pool, orgId, messageId) {
  return withOrg(pool, orgId, async c => (await c.query('select t.number, t.requester_email from ticket_messages m join tickets t on t.id = m.ticket_id and t.org_id = m.org_id where m.org_id = $1 and m.message_id = $2', [orgId, String(messageId || '')])).rows[0] || null);
}
export async function messageSeen(pool, orgId, messageId) {
  return withOrg(pool, orgId, async c => (await c.query('select 1 from ticket_messages where org_id = $1 and message_id = $2', [orgId, String(messageId || '')])).rowCount > 0);
}
