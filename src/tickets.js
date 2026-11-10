// src/tickets.js: THE TICKET CORE. Every function runs inside withOrg (row level security) AND names org_id in its queries, so a mistake in one layer is caught by the other.
import { withOrg } from './db.js';

export const STATUSES = ['open', 'pending', 'solved', 'closed'];
export const PRIORITIES = ['low', 'normal', 'high', 'urgent'];
const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
const cleanTags = t => [...new Set((Array.isArray(t) ? t : String(t || '').split(',')).map(x => clean(x, 30).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))].slice(0, 20);
const fail = (error, status = 400) => ({ ok: false, status, error });
const ticketCols = 'id, number, subject, status, priority, channel, requester_name, requester_email, assignee_id, tags, first_response_at, solved_at, created_at, updated_at';

// a new ticket with its first message (from the requester, or from an agent who is logging a call)
export async function createTicket(pool, orgId, actor, input) {
  const subject = clean(input.subject, 200), body = clean(input.body, 20000), email = clean(input.requesterEmail, 254).toLowerCase();
  if (!subject) return fail('Give the ticket a subject.');
  if (!body) return fail('Write the first message.');
  if (!isEmail(email)) return fail('Enter the requester\'s email address.');
  const priority = PRIORITIES.includes(input.priority) ? input.priority : 'normal';
  return withOrg(pool, orgId, async c => {
    const n = (await c.query('insert into ticket_counters (org_id, last_number) values ($1, 1) on conflict (org_id) do update set last_number = ticket_counters.last_number + 1 returning last_number', [orgId])).rows[0].last_number;
    const t = (await c.query(`insert into tickets (org_id, number, subject, priority, channel, requester_name, requester_email, tags) values ($1,$2,$3,$4,$5,$6,$7,$8) returning ${ticketCols}`, [orgId, n, subject, priority, input.channel === 'email' || input.channel === 'api' ? input.channel : 'web', clean(input.requesterName, 100), email, cleanTags(input.tags)])).rows[0];
    const mid = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_id, author_name, body, message_id) values ($1,$2,$3,$4,$5,$6,$7) returning id', [orgId, t.id, 'requester', null, clean(input.requesterName, 100) || email, body, input.messageId ? clean(input.messageId, 300) : null])).rows[0].id;
    return { ok: true, ticket: t, messageRowId: mid };
  });
}

// the list: filter by status, assignee ("me", "none" or a user id), a text search and one tag; newest activity first; paged
export async function listTickets(pool, orgId, actor, q = {}) {
  const where = ['org_id = $1'], args = [orgId], add = (sql, v) => { args.push(v); where.push(sql.replace('$#', '$' + args.length)); };
  if (STATUSES.includes(q.status)) add('status = $#', q.status);
  else if (q.status === 'active') where.push("status in ('open','pending')");
  if (q.assignee === 'me') add('assignee_id = $#', actor.id); else if (q.assignee === 'none') where.push('assignee_id is null'); else if (q.assignee) add('assignee_id = $#', clean(q.assignee, 64));
  if (q.tag) add('$# = any(tags)', clean(q.tag, 30).toLowerCase());
  const text = clean(q.q, 100);
  if (text) { const like = '%' + text.replace(/[\\%_]/g, m => '\\' + m) + '%'; args.push(like); const i = args.length; where.push(`(subject ilike $${i} or requester_email ilike $${i} or requester_name ilike $${i} or (case when $${i + 1}::int is null then false else number = $${i + 1}::int end))`); args.push(/^#?\d{1,9}$/.test(text) ? Number(text.replace('#', '')) : null); }
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 50, 1), 100), offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  return withOrg(pool, orgId, async c => {
    const rows = (await c.query(`select ${ticketCols} from tickets where ${where.join(' and ')} order by updated_at desc, id desc limit ${limit} offset ${offset}`, args)).rows;
    const counts = Object.fromEntries((await c.query('select status, count(*)::int n from tickets where org_id = $1 group by status', [orgId])).rows.map(r => [r.status, r.n]));
    return { ok: true, tickets: rows, counts: { open: 0, pending: 0, solved: 0, closed: 0, ...counts } };
  });
}

export async function getTicket(pool, orgId, actor, number) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query(`select ${ticketCols} from tickets where org_id = $1 and number = $2`, [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    const messages = (await c.query('select id, kind, author_id, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = $2 order by created_at, id', [orgId, t.id])).rows;
    const files = (await c.query('select id, message_id, filename, content_type, size from attachments where org_id = $1 and ticket_id = $2 and message_id is not null order by created_at', [orgId, t.id])).rows;
    for (const m of messages) m.attachments = files.filter(f => f.message_id === m.id).map(f => ({ id: f.id, filename: f.filename, contentType: f.content_type, size: f.size }));
    return { ok: true, ticket: t, messages };
  });
}

// a public reply (kind agent) or an internal note; a public reply by an agent is the first response, and moves an open ticket to pending
export async function addMessage(pool, orgId, actor, number, { body, internal, status }) {
  const text = clean(body, 20000); if (!text) return fail('Write a message first.');
  if (status && !STATUSES.includes(status)) return fail('That status does not exist.');
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, status, first_response_at from tickets where org_id = $1 and number = $2 for update', [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    const kind = internal ? 'note' : 'agent';
    const m = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_id, author_name, body) values ($1,$2,$3,$4,$5,$6) returning id, kind, author_id, author_name, body, created_at', [orgId, t.id, kind, actor.id, clean(actor.name, 100) || actor.email, text])).rows[0];
    const next = status || (!internal && t.status === 'open' ? 'pending' : t.status);
    await c.query(`update tickets set status = $3, first_response_at = coalesce(first_response_at, case when $4 then now() end), solved_at = case when $3 in ('solved','closed') then coalesce(solved_at, now()) else null end, updated_at = now() where org_id = $1 and id = $2`, [orgId, t.id, next, !internal]);
    return { ok: true, message: m, status: next };
  });
}

// status, priority, assignee (an organization member or null) and tags
export async function updateTicket(pool, orgId, actor, number, patch) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, status from tickets where org_id = $1 and number = $2 for update', [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    const sets = [], args = [orgId, t.id], set = (col, v) => { args.push(v); sets.push(`${col} = $${args.length}`); };
    if (patch.status !== undefined) { if (!STATUSES.includes(patch.status)) return fail('That status does not exist.'); set('status', patch.status); sets.push(`solved_at = case when $${args.length} in ('solved','closed') then coalesce(solved_at, now()) else null end`); }
    if (patch.priority !== undefined) { if (!PRIORITIES.includes(patch.priority)) return fail('That priority does not exist.'); set('priority', patch.priority); }
    if (patch.assigneeId !== undefined) {
      if (patch.assigneeId === null || patch.assigneeId === '') set('assignee_id', null);
      else { const ok = (await c.query('select 1 from member where "organizationId" = $1 and "userId" = $2', [orgId, String(patch.assigneeId)])).rowCount; if (!ok) return fail('That person is not part of this organization.'); set('assignee_id', String(patch.assigneeId)); }
    }
    if (patch.tags !== undefined) set('tags', cleanTags(patch.tags));
    if (!sets.length) return fail('Nothing to change.');
    const row = (await c.query(`update tickets set ${sets.join(', ')}, updated_at = now() where org_id = $1 and id = $2 returning ${ticketCols}`, args)).rows[0];
    return { ok: true, ticket: row };
  });
}

export async function listAgents(pool, orgId) {
  return (await pool.query('select u.id, u.name, u.email, m.role from member m join "user" u on u.id = m."userId" where m."organizationId" = $1 order by u.name', [orgId])).rows;
}

// ---- used by the inbound email webhook (no signed-in agent) ----
// a message from the requester: a solved or pending ticket becomes open again; a closed ticket cannot be reopened (the caller then starts a follow-up ticket)
export async function addRequesterMessage(pool, orgId, number, { body, authorName, messageId }) {
  const text = clean(body, 20000); if (!text) return fail('Empty message.');
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id, status from tickets where org_id = $1 and number = $2 for update', [orgId, Number(number) || 0])).rows[0];
    if (!t) return fail('No such ticket.', 404);
    if (t.status === 'closed') return { ok: false, status: 409, closed: true, error: 'The ticket is closed.' };
    const mid = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_name, body, message_id) values ($1,$2,$3,$4,$5,$6) returning id', [orgId, t.id, 'requester', clean(authorName, 100), text, messageId ? clean(messageId, 300) : null])).rows[0].id;
    await c.query("update tickets set status = 'open', solved_at = null, updated_at = now() where org_id = $1 and id = $2", [orgId, t.id]);
    return { ok: true, reopened: t.status !== 'open', messageRowId: mid };
  });
}
export async function ticketByMessageId(pool, orgId, messageId) {
  return withOrg(pool, orgId, async c => (await c.query('select t.number, t.requester_email from ticket_messages m join tickets t on t.id = m.ticket_id and t.org_id = m.org_id where m.org_id = $1 and m.message_id = $2', [orgId, String(messageId || '')])).rows[0] || null);
}
export async function messageSeen(pool, orgId, messageId) {
  return withOrg(pool, orgId, async c => (await c.query('select 1 from ticket_messages where org_id = $1 and message_id = $2', [orgId, String(messageId || '')])).rowCount > 0);
}
