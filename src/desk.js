// src/desk.js: THE DESK FEATURES around a ticket: queues, followers, merge, editing a message, labels, clients with notes, linked problem/incident tickets, macros, saved views and side conversations (an email to a third party, whose replies come back to the ticket). Every function runs inside withOrg and names org_id; the caller has already checked the person belongs to the organization and has the plan feature.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { inboundDomain } from './config.js';
import { getEntitlements } from './billing.js';
import { mailLimit } from './plans.js';
import { logEvent, cleanText as clean, validEmail } from './tickets.js';

const fail = (error, status = 400) => ({ ok: false, status, error });
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const idOf = v => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2 ** 53 ? n : 0; };
const who = a => (a && (a.name || a.email)) || 'Someone';
const ticketRow = async (c, orgId, number, cols = 'id, number, status') => (await c.query(`select ${cols} from tickets where org_id = $1 and number = $2 for update`, [orgId, Number(number) || 0])).rows[0];

// ---------- queues ----------
export const listQueues = (pool, orgId) => withOrg(pool, orgId, async c => ({ ok: true, queues: (await c.query('select q.id, q.name, (select count(*)::int from tickets t where t.org_id = q.org_id and t.queue_id = q.id and t.status in (\'open\',\'pending\')) active from queues q where q.org_id = $1 order by lower(q.name)', [orgId])).rows }));
export const saveQueue = (pool, orgId, { id, name }) => withOrg(pool, orgId, async c => {
  const n = clean(name, 60); if (!n) return fail('Give the queue a name.');
  try {
    if (id) { const r = await c.query('update queues set name = $3 where org_id = $1 and id = $2 returning id', [orgId, idOf(id), n]); if (!r.rowCount) return fail('No such queue.', 404); return { ok: true, id: r.rows[0].id }; }
    if ((await c.query('select count(*)::int n from queues where org_id = $1', [orgId])).rows[0].n >= 50) return fail('An organization can have up to 50 queues.');
    return { ok: true, id: (await c.query('insert into queues (org_id, name) values ($1,$2) returning id', [orgId, n])).rows[0].id };
  } catch (e) { if (e.code === '23505') return fail('There is already a queue with that name.', 409); throw e; }
});
export const deleteQueue = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from queues where org_id = $1 and id = $2', [orgId, idOf(id)])).rowCount ? { ok: true } : fail('No such queue.', 404));

// ---------- labels (the tags in use, for suggestions) ----------
export const labelsInUse = (pool, orgId) => withOrg(pool, orgId, async c => ({ ok: true, labels: (await c.query('select t as name, count(*)::int n from tickets, unnest(tags) t where org_id = $1 group by t order by n desc, t limit 200', [orgId])).rows }));

// ---------- followers ----------
export const follow = (pool, orgId, actor, number, on) => withOrg(pool, orgId, async c => {
  const t = await ticketRow(c, orgId, number); if (!t) return fail('No such ticket.', 404);
  if (on) await c.query('insert into ticket_followers (org_id, ticket_id, user_id) values ($1,$2,$3) on conflict do nothing', [orgId, t.id, actor.id]);
  else await c.query('delete from ticket_followers where org_id = $1 and ticket_id = $2 and user_id = $3', [orgId, t.id, actor.id]);
  return { ok: true, following: !!on };
});

// ---------- merge: every message, file, side conversation and follower of the source moves to the target; the source is closed and points to it ----------
export const mergeTickets = (pool, orgId, actor, sourceNumber, targetNumber) => withOrg(pool, orgId, async c => {
  const a = Number(sourceNumber) || 0, b = Number(targetNumber) || 0;
  if (!a || !b) return fail('Enter the number of the ticket to merge into.'); if (a === b) return fail('A ticket cannot be merged into itself.');
  const lo = a < b ? a : b, hi = a < b ? b : a;                         // lock in a fixed order so two merges cannot deadlock
  await c.query('select id from tickets where org_id = $1 and number in ($2,$3) order by number for update', [orgId, lo, hi]);
  const cols = 'id, number, subject, status, tags, cc, merged_into', s = (await c.query(`select ${cols} from tickets where org_id = $1 and number = $2`, [orgId, a])).rows[0], d = (await c.query(`select ${cols} from tickets where org_id = $1 and number = $2`, [orgId, b])).rows[0];
  if (!s) return fail('No such ticket.', 404); if (!d) return fail(`There is no ticket #${b}.`, 404);
  if (s.merged_into) return fail(`Ticket #${a} was already merged into #${s.merged_into}.`, 409); if (d.merged_into) return fail(`Ticket #${b} was merged into #${d.merged_into}. Merge into that one instead.`, 409);
  if (d.status === 'closed') return fail(`Ticket #${b} is closed. Merge into an open ticket.`, 409);
  await c.query('update ticket_messages set ticket_id = $3 where org_id = $1 and ticket_id = $2', [orgId, s.id, d.id]);
  await c.query('update attachments set ticket_id = $3 where org_id = $1 and ticket_id = $2', [orgId, s.id, d.id]);
  await c.query('update side_conversations set ticket_id = $3 where org_id = $1 and ticket_id = $2', [orgId, s.id, d.id]);
  await c.query('insert into ticket_followers (org_id, ticket_id, user_id) select org_id, $3, user_id from ticket_followers where org_id = $1 and ticket_id = $2 on conflict do nothing', [orgId, s.id, d.id]);
  await c.query('update tickets set problem_number = $3 where org_id = $1 and problem_number = $2', [orgId, a, b]);
  await c.query('update tickets set tags = $3, cc = $4, updated_at = now() where org_id = $1 and id = $2', [orgId, d.id, [...new Set([...d.tags, ...s.tags])].slice(0, 20), [...new Set([...d.cc, ...s.cc])].slice(0, 10)]);
  await c.query(`update tickets set status = 'closed', merged_into = $3, solved_at = coalesce(solved_at, now()), updated_at = now() where org_id = $1 and id = $2`, [orgId, s.id, b]);
  await c.query("insert into ticket_messages (org_id, ticket_id, kind, author_name, body) values ($1,$2,'system',$3,$4)", [orgId, d.id, who(actor), `Ticket #${a} "${s.subject}" was merged into this ticket.`]);
  await c.query("insert into ticket_messages (org_id, ticket_id, kind, author_name, body) values ($1,$2,'system',$3,$4)", [orgId, s.id, who(actor), `This ticket was merged into #${b}.`]);
  await logEvent(c, orgId, d.id, who(actor), 'merge', `Ticket #${a} merged into this ticket`); await logEvent(c, orgId, s.id, who(actor), 'merge', `Merged into #${b}`);
  return { ok: true, into: b };
});

// ---------- editing a message: only its author, only agent replies and notes, and the email that already went out is not re-sent ----------
export const editMessage = (pool, orgId, actor, number, messageId, body) => withOrg(pool, orgId, async c => {
  const text = clean(body, 20000).length ? String(body).replace(/\u0000/g, '').trim().slice(0, 20000) : ''; if (!text) return fail('A message cannot be empty.');
  const t = await ticketRow(c, orgId, number); if (!t) return fail('No such ticket.', 404);
  const m = (await c.query('select id, kind, author_id from ticket_messages where org_id = $1 and ticket_id = $2 and id = $3', [orgId, t.id, idOf(messageId)])).rows[0];
  if (!m) return fail('No such message.', 404); if (m.kind !== 'agent' && m.kind !== 'note') return fail('Only replies and notes written by your team can be edited.', 403); if (m.author_id !== actor.id) return fail('You can only edit your own messages.', 403);
  await c.query('update ticket_messages set body = $3, edited_at = now() where org_id = $1 and id = $2', [orgId, m.id, text]);
  await logEvent(c, orgId, t.id, who(actor), 'edit', m.kind === 'note' ? 'Internal note edited' : 'Public reply edited (the email already sent is unchanged)');
  return { ok: true };
});

// ---------- clients: companies with notes; a client with a domain picks up new tickets from that domain ----------
const domainOk = d => d === '' || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(d);
export const listClients = (pool, orgId) => withOrg(pool, orgId, async c => ({ ok: true, clients: (await c.query("select k.id, k.name, k.domain, k.share_tickets, (select count(*)::int from tickets t where t.org_id = k.org_id and t.client_id = k.id) tickets from clients k where k.org_id = $1 order by lower(k.name)", [orgId])).rows }));
export const saveClient = (pool, orgId, actor, b) => withOrg(pool, orgId, async c => {
  const name = clean(b.name, 100), domain = clean(b.domain, 100).toLowerCase().replace(/^@/, ''); if (!name) return fail('Give the client a name.'); if (!domainOk(domain)) return fail('Enter the domain like acme.com, or leave it empty.');
  try {
    if (b.id) { const r = await c.query('update clients set name = $3, domain = $4, share_tickets = $5 where org_id = $1 and id = $2 returning id', [orgId, idOf(b.id), name, domain, b.shareTickets === true]); if (!r.rowCount) return fail('No such client.', 404); return { ok: true, id: r.rows[0].id }; }
    if ((await c.query('select count(*)::int n from clients where org_id = $1', [orgId])).rows[0].n >= 500) return fail('An organization can have up to 500 clients.');
    return { ok: true, id: (await c.query('insert into clients (org_id, name, domain, share_tickets) values ($1,$2,$3,$4) returning id', [orgId, name, domain, b.shareTickets === true])).rows[0].id };
  } catch (e) { if (e.code === '23505') return fail('There is already a client with that name.', 409); throw e; }
});
export const deleteClient = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from clients where org_id = $1 and id = $2', [orgId, idOf(id)])).rowCount ? { ok: true } : fail('No such client.', 404));
export const saveClientNotes = (pool, orgId, id, notes) => withOrg(pool, orgId, async c => { const n = String(notes == null ? '' : notes).replace(/\u0000/g, '').slice(0, 5000); return (await c.query('update clients set notes = $3 where org_id = $1 and id = $2', [orgId, idOf(id), n])).rowCount ? { ok: true } : fail('No such client.', 404); });

// ---------- macros: a canned reply that can also set status, priority and tags ----------
export const listMacros = (pool, orgId) => withOrg(pool, orgId, async c => ({ ok: true, macros: (await c.query('select id, name, body, status, priority, add_tags from macros where org_id = $1 order by lower(name)', [orgId])).rows }));
export const saveMacro = (pool, orgId, b) => withOrg(pool, orgId, async c => {
  const name = clean(b.name, 80), body = String(b.body == null ? '' : b.body).replace(/\u0000/g, '').trim().slice(0, 5000); if (!name) return fail('Give the macro a name.'); if (!body) return fail('Write the reply the macro inserts.');
  const status = ['open', 'pending', 'solved', 'closed'].includes(b.status) ? b.status : null, priority = ['low', 'normal', 'high', 'urgent'].includes(b.priority) ? b.priority : null;
  const tags = [...new Set((Array.isArray(b.addTags) ? b.addTags : String(b.addTags || '').split(',')).map(x => clean(x, 30).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '')).filter(Boolean))].slice(0, 10);
  try {
    if (b.id) { const r = await c.query('update macros set name = $3, body = $4, status = $5, priority = $6, add_tags = $7 where org_id = $1 and id = $2 returning id', [orgId, idOf(b.id), name, body, status, priority, tags]); if (!r.rowCount) return fail('No such macro.', 404); return { ok: true, id: r.rows[0].id }; }
    if ((await c.query('select count(*)::int n from macros where org_id = $1', [orgId])).rows[0].n >= 200) return fail('An organization can have up to 200 macros.');
    return { ok: true, id: (await c.query('insert into macros (org_id, name, body, status, priority, add_tags) values ($1,$2,$3,$4,$5,$6) returning id', [orgId, name, body, status, priority, tags])).rows[0].id };
  } catch (e) { if (e.code === '23505') return fail('There is already a macro with that name.', 409); throw e; }
});
export const deleteMacro = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from macros where org_id = $1 and id = $2', [orgId, idOf(id)])).rowCount ? { ok: true } : fail('No such macro.', 404));

// ---------- saved views: a named filter, private to its owner or shared with the team ----------
const VIEW_KEYS = ['status', 'assignee', 'queue', 'type', 'client', 'tag', 'q', 'following'];
const VIEW_COLUMNS = ['status', 'number', 'subject', 'requester', 'priority', 'assignee', 'sla', 'updated'];
const DEFAULT_VIEW_COLUMNS = ['status', 'number', 'subject', 'requester', 'priority', 'assignee', 'updated'];
export const listViews = (pool, orgId, actor) => withOrg(pool, orgId, async c => ({ ok: true, views: (await c.query('select id, name, owner_id, filter, columns from saved_views where org_id = $1 and (owner_id is null or owner_id = $2) order by lower(name)', [orgId, actor.id])).rows.map(v => ({ id: v.id, name: v.name, shared: v.owner_id === null, mine: v.owner_id === actor.id, filter: v.filter, columns: Array.isArray(v.columns) && v.columns.length ? v.columns : DEFAULT_VIEW_COLUMNS })) }));
export const saveView = (pool, orgId, actor, b) => withOrg(pool, orgId, async c => {
  const name = clean(b.name, 60); if (!name) return fail('Give the view a name.');
  const f = {}; for (const k of VIEW_KEYS) if (b.filter && b.filter[k] != null && b.filter[k] !== '') f[k] = clean(b.filter[k], 100);
  if (!Object.keys(f).length) return fail('Choose at least one filter first.');
  const columns = [...new Set((Array.isArray(b.columns) ? b.columns : DEFAULT_VIEW_COLUMNS).filter(k => VIEW_COLUMNS.includes(k)))];
  if (!columns.length) return fail('Choose at least one ticket column.');
  if ((await c.query('select count(*)::int n from saved_views where org_id = $1', [orgId])).rows[0].n >= 100) return fail('An organization can have up to 100 saved views.');
  return { ok: true, id: (await c.query('insert into saved_views (org_id, name, owner_id, filter, columns) values ($1,$2,$3,$4,$5) returning id', [orgId, name, b.shared === true ? null : actor.id, f, JSON.stringify(columns)])).rows[0].id };
});
export const deleteView = (pool, orgId, actor, id, canAdmin) => withOrg(pool, orgId, async c => {
  const v = (await c.query('select owner_id from saved_views where org_id = $1 and id = $2', [orgId, idOf(id)])).rows[0]; if (!v) return fail('No such view.', 404);
  if (v.owner_id !== actor.id && !(v.owner_id === null && canAdmin)) return fail('Only the owner of a view or an admin can delete it.', 403);
  await c.query('delete from saved_views where org_id = $1 and id = $2', [orgId, idOf(id)]); return { ok: true };
});

// ---------- linked tickets: incidents point to a problem ticket; solving the problem solves them ----------
export const linkIncident = (pool, orgId, actor, number, problemNumber) => withOrg(pool, orgId, async c => {
  const a = Number(number) || 0, p = Number(problemNumber) || 0; if (!p) return fail('Enter the problem ticket number.'); if (a === p) return fail('A ticket cannot be linked to itself.');
  const lo = Math.min(a, p), hi = Math.max(a, p); await c.query('select id from tickets where org_id = $1 and number in ($2,$3) order by number for update', [orgId, lo, hi]);
  const t = (await c.query('select id, type, problem_number from tickets where org_id = $1 and number = $2', [orgId, a])).rows[0], pt = (await c.query('select id, type, problem_number from tickets where org_id = $1 and number = $2', [orgId, p])).rows[0];
  if (!t) return fail('No such ticket.', 404); if (!pt) return fail(`There is no ticket #${p}.`, 404); if (pt.problem_number) return fail(`Ticket #${p} is itself an incident of #${pt.problem_number}. Link to that problem instead.`, 409);
  await c.query("update tickets set type = 'incident', problem_number = $3, updated_at = now() where org_id = $1 and id = $2", [orgId, t.id, p]);
  if (pt.type !== 'problem') await c.query("update tickets set type = 'problem', updated_at = now() where org_id = $1 and id = $2", [orgId, pt.id]);
  await logEvent(c, orgId, t.id, who(actor), 'link', `Linked as an incident of #${p}`); await logEvent(c, orgId, pt.id, who(actor), 'link', `Ticket #${a} linked as an incident`);
  return { ok: true };
});
export const unlinkIncident = (pool, orgId, actor, number) => withOrg(pool, orgId, async c => {
  const t = await ticketRow(c, orgId, number, 'id, number, problem_number'); if (!t) return fail('No such ticket.', 404); if (!t.problem_number) return fail('That ticket is not linked to a problem.');
  await c.query("update tickets set problem_number = null, type = 'question', updated_at = now() where org_id = $1 and id = $2", [orgId, t.id]); await logEvent(c, orgId, t.id, who(actor), 'link', `Unlinked from problem #${t.problem_number}`); return { ok: true };
});
export const resolveProblem = (pool, orgId, actor, number) => withOrg(pool, orgId, async c => {
  const p = await ticketRow(c, orgId, number, 'id, number, type'); if (!p) return fail('No such ticket.', 404);
  const inc = (await c.query("select id, number from tickets where org_id = $1 and problem_number = $2 and status not in ('solved','closed') for update", [orgId, p.number])).rows;
  for (const t of inc) { await c.query("update tickets set status = 'solved', solved_at = coalesce(solved_at, now()), updated_at = now() where org_id = $1 and id = $2", [orgId, t.id]); await c.query("insert into ticket_messages (org_id, ticket_id, kind, author_name, body) values ($1,$2,'system',$3,$4)", [orgId, t.id, who(actor), `Solved together with problem #${p.number}.`]); await logEvent(c, orgId, t.id, who(actor), 'status', `Solved with problem #${p.number}`); }
  await c.query("update tickets set status = 'solved', solved_at = coalesce(solved_at, now()), updated_at = now() where org_id = $1 and id = $2", [orgId, p.id]); await logEvent(c, orgId, p.id, who(actor), 'status', `Problem solved, with ${inc.length} linked incident${inc.length === 1 ? '' : 's'}`);
  return { ok: true, solved: inc.length };
});

// ---------- side conversations ----------
const secret = env => String(env.EMAIL_TOKEN_SECRET || env.BETTER_AUTH_SECRET || '');
export const sideToken = (env, orgId, id) => crypto.createHmac('sha256', secret(env)).update(`side:${orgId}:${id}`).digest('hex').slice(0, 12);
export const sideTokenOk = (env, orgId, id, tok) => { const want = Buffer.from(sideToken(env, orgId, id)), got = Buffer.from(String(tok || '')); return !!secret(env) && want.length === got.length && crypto.timingSafeEqual(want, got); };

export async function listSides(c, orgId, ticketId) {
  const sides = (await c.query('select id, to_email, subject, status, created_at from side_conversations where org_id = $1 and ticket_id = $2 order by created_at', [orgId, ticketId])).rows;
  const msgs = sides.length ? (await c.query('select id, side_id, direction, author_name, body, created_at from side_messages where org_id = $1 and side_id = any($2) order by created_at, id', [orgId, sides.map(s => s.id)])).rows : [];
  return sides.map(s => ({ ...s, messages: msgs.filter(m => m.side_id === s.id) }));
}
// starts (no sideId) or continues (with sideId) a conversation with someone outside the team; the mail is sent after it is saved and its result says how it went
export async function sendSide(pool, mailer, env, orgId, actor, number, { sideId, to, subject, body }) {
  const text = String(body == null ? '' : body).replace(/\u0000/g, '').trim().slice(0, 20000); if (!text) return fail('Write a message first.');
  const saved = await withOrg(pool, orgId, async c => {
    const t = await ticketRow(c, orgId, number, 'id, number, subject'); if (!t) return fail('No such ticket.', 404);
    let side;
    if (sideId) { side = (await c.query('select id, to_email, subject, status from side_conversations where org_id = $1 and ticket_id = $2 and id = $3', [orgId, t.id, idOf(sideId)])).rows[0]; if (!side) return fail('No such conversation.', 404); if (side.status === 'closed') return fail('That conversation is closed.', 409); }
    else {
      const addr = clean(to, 254).toLowerCase(), subj = clean(subject, 200) || t.subject; if (!validEmail(addr)) return fail('Enter the email address of the person to write to.');
      if ((await c.query('select count(*)::int n from side_conversations where org_id = $1 and ticket_id = $2', [orgId, t.id])).rows[0].n >= 10) return fail('A ticket can have up to 10 side conversations.');
      side = (await c.query('insert into side_conversations (org_id, ticket_id, to_email, subject, created_by) values ($1,$2,$3,$4,$5) returning id, to_email, subject', [orgId, t.id, addr, subj, actor.id])).rows[0];
      await logEvent(c, orgId, t.id, who(actor), 'side', `Side conversation started with ${addr}`);
    }
    const m = (await c.query("insert into side_messages (org_id, side_id, direction, author_name, body) values ($1,$2,'out',$3,$4) returning id", [orgId, side.id, who(actor), text])).rows[0];
    await c.query('update tickets set updated_at = now() where org_id = $1 and id = $2', [orgId, t.id]);
    return { ok: true, t, side, messageId: m.id };
  });
  if (!saved.ok) return saved;
  const out = { ok: true, sideId: saved.side.id, email: 'skipped', why: '' };
  try {
    const domain = inboundDomain(env), d = await withOrg(pool, orgId, async c => {
      const inbox = (await c.query('select inbox from inbox_directory where org_id = $1', [orgId])).rows[0]?.inbox, settings = (await c.query('select from_name, signature from mail_settings where org_id = $1', [orgId])).rows[0];
      const orgName = (await c.query('select name from "organization" where id = $1', [orgId])).rows[0]?.name || '';
      const sent = (await c.query("select (select count(*) from ticket_messages where org_id = $1 and delivery = 'sent' and created_at > now() - interval '24 hours') + (select count(*) from side_messages where org_id = $1 and direction = 'out' and created_at > now() - interval '24 hours') n", [orgId])).rows[0].n;
      const prev = (await c.query("select message_id from side_messages where org_id = $1 and side_id = $2 and message_id is not null order by created_at desc limit 5", [orgId, saved.side.id])).rows.map(r => r.message_id);
      return { inbox, settings, orgName, sent: Number(sent), prev };
    });
    if (!d.inbox) { out.why = 'no-inbox'; return out; }
    if (d.sent > mailLimit(await getEntitlements(pool, orgId))) { out.why = 'limit'; return out; }
    const display = clean(d.settings?.from_name, 100) || d.orgName || 'Support', mid = `<s${saved.messageId}.${crypto.randomBytes(8).toString('hex')}@${domain}>`;
    const sig = d.settings?.signature ? `\n\n-- \n${d.settings.signature}` : '';
    await mailer.ticketMail({ from: `${display.replace(/[<>"]/g, '')} <${d.inbox}@${domain}>`, to: saved.side.to_email, replyTo: `${d.inbox}+s${saved.side.id}.${sideToken(env, orgId, saved.side.id)}@${domain}`, subject: `[#${saved.t.number}] ${saved.side.subject}`, text: text + sig,
      html: `<div style="white-space:pre-wrap">${esc(text)}</div>${d.settings?.signature ? `<p style="color:#68737d;white-space:pre-wrap">-- <br>${esc(d.settings.signature)}</p>` : ''}`, headers: { 'Message-ID': mid, ...(d.prev.length ? { 'In-Reply-To': d.prev[0] } : {}), 'Auto-Submitted': 'no' } });
    await withOrg(pool, orgId, c => c.query('update side_messages set message_id = $3 where org_id = $1 and id = $2', [orgId, saved.messageId, mid])); out.email = 'sent';
  } catch (e) { console.warn('side conversation mail failed:', e.message); out.email = 'failed'; }
  return out;
}
export const closeSide = (pool, orgId, actor, number, sideId) => withOrg(pool, orgId, async c => {
  const t = await ticketRow(c, orgId, number, 'id'); if (!t) return fail('No such ticket.', 404);
  const r = await c.query("update side_conversations set status = 'closed' where org_id = $1 and ticket_id = $2 and id = $3 returning to_email", [orgId, t.id, idOf(sideId)]); if (!r.rowCount) return fail('No such conversation.', 404);
  await logEvent(c, orgId, t.id, who(actor), 'side', `Side conversation with ${r.rows[0].to_email} closed`); return { ok: true };
});
// the reply of the person on the other side (called by the inbound mail handler after the private address is checked); only that person's own address counts
export const sideReplyIn = (pool, orgId, sideId, fromEmail, authorName, body, messageId) => withOrg(pool, orgId, async c => {
  const s = (await c.query('select s.id, s.to_email, s.status, t.id ticket_id, t.number from side_conversations s join tickets t on t.id = s.ticket_id and t.org_id = s.org_id where s.org_id = $1 and s.id = $2', [orgId, idOf(sideId)])).rows[0];
  if (!s) return { dropped: 'no-ticket' }; if (s.to_email !== fromEmail) return { dropped: 'wrong-sender' }; if (s.status === 'closed') return { dropped: 'side-closed' };
  await c.query("insert into side_messages (org_id, side_id, direction, author_name, body, message_id) values ($1,$2,'in',$3,$4,$5)", [orgId, s.id, clean(authorName, 100) || fromEmail, String(body).slice(0, 20000), messageId ? clean(messageId, 300) : null]);
  await c.query('update tickets set updated_at = now() where org_id = $1 and id = $2', [orgId, s.ticket_id]); await logEvent(c, orgId, s.ticket_id, clean(authorName, 100) || fromEmail, 'side', `Reply in the side conversation with ${s.to_email}`);
  return { ok: true, action: 'side-replied', number: s.number };
});

// ---------- everything the ticket screen needs besides the ticket and its messages ----------
export const extras = (pool, orgId, actor, ticket) => withOrg(pool, orgId, async c => {
  const followers = (await c.query('select f.user_id, u.name, u.email from ticket_followers f join "user" u on u.id = f.user_id where f.org_id = $1 and f.ticket_id = $2', [orgId, ticket.id])).rows;
  const events = (await c.query('select actor_name, kind, detail, created_at from ticket_events where org_id = $1 and ticket_id = $2 order by created_at desc, id desc limit 60', [orgId, ticket.id])).rows;
  const sides = await listSides(c, orgId, ticket.id);
  let client = null;
  if (ticket.client_id) {
    const k = (await c.query('select id, name, domain, notes, share_tickets from clients where org_id = $1 and id = $2', [orgId, ticket.client_id])).rows[0];
    if (k) client = { ...k, stats: (await c.query("select count(*)::int total, count(*) filter (where status in ('open','pending'))::int open, count(*) filter (where status in ('solved','closed'))::int solved from tickets where org_id = $1 and client_id = $2", [orgId, k.id])).rows[0], people: (await c.query('select requester_email email, max(requester_name) name, count(*)::int tickets from tickets where org_id = $1 and client_id = $2 group by requester_email order by count(*) desc limit 20', [orgId, k.id])).rows };
  }
  const problem = ticket.problem_number ? (await c.query('select number, subject, status from tickets where org_id = $1 and number = $2', [orgId, ticket.problem_number])).rows[0] || null : null;
  const incidents = ticket.type === 'problem' ? (await c.query('select number, subject, status from tickets where org_id = $1 and problem_number = $2 order by number', [orgId, ticket.number])).rows : [];
  const merged = (await c.query('select number, subject from tickets where org_id = $1 and merged_into = $2 order by number', [orgId, ticket.number])).rows;
  return { followers, following: followers.some(f => f.user_id === actor.id), events, sides, client, problem, incidents, merged };
});

// ----- custom ticket statuses: a name the workspace chooses, always inside one of the four built-in categories
const CATEGORIES = ['open', 'pending', 'solved', 'closed'];
export const listStatuses = (pool, orgId) => withOrg(pool, orgId, async c => ({ ok: true, statuses: (await c.query('select s.id, s.name, s.category, s.position, (select count(*)::int from tickets t where t.org_id = s.org_id and t.custom_status_id = s.id) tickets from ticket_statuses s where s.org_id = $1 order by s.position, s.id', [orgId])).rows }));
export const saveStatus = (pool, orgId, { id, name, category, position }) => withOrg(pool, orgId, async c => {
  const n = clean(name, 40); if (!n) return fail('Give the status a name.'); if (!CATEGORIES.includes(category)) return fail('Choose which built-in status it counts as: open, pending, solved or closed.');
  if (CATEGORIES.includes(n.toLowerCase())) return fail('That name is already a built-in status.');
  try {
    if (id) { const r = await c.query('update ticket_statuses set name = $3, category = $4 where org_id = $1 and id = $2 returning id', [orgId, idOf(id), n, category]); if (!r.rowCount) return fail('No such status.', 404); await c.query('update tickets set status = $3, solved_at = case when $3 in (\'solved\',\'closed\') then coalesce(solved_at, now()) else null end where org_id = $1 and custom_status_id = $2 and status <> $3', [orgId, idOf(id), category]); return { ok: true, id: r.rows[0].id }; }
    if ((await c.query('select count(*)::int n from ticket_statuses where org_id = $1', [orgId])).rows[0].n >= 20) return fail('An organization can have up to 20 custom statuses.');
    return { ok: true, id: (await c.query('insert into ticket_statuses (org_id, name, category, position) values ($1,$2,$3,(select coalesce(max(position),0)+1 from ticket_statuses where org_id = $1)) returning id', [orgId, n, category])).rows[0].id };
  } catch (e) { if (e.code === '23505') return fail('There is already a status with that name.', 409); throw e; }
});
export const deleteStatus = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from ticket_statuses where org_id = $1 and id = $2', [orgId, idOf(id)])).rowCount ? { ok: true } : fail('No such status.', 404));
