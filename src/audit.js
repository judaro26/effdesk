// src/audit.js: THE AUDIT LOG for owners and admins (Pro): who changed what, and when, with a filter and a CSV; plus the data export of everything the organization holds.
import { withOrg } from './db.js';
const q = s => { s = s == null ? '' : String(s); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (head, rows) => [head.join(','), ...rows.map(r => head.map(h => q(r[h])).join(','))].join('\r\n') + '\r\n';
export async function listAudit(pool, orgId, b = {}) {
  const limit = Math.min(200, Math.max(1, Number(b.limit) || 50)), before = Number(b.before) || null, like = String(b.filter || '').trim().replace(/[%_\\]/g, '\\$&').slice(0, 60), who = String(b.actor || '').trim().toLowerCase().slice(0, 100);
  const rows = (await withOrg(pool, orgId, async c => (await c.query(
    `select a.id, a.at, a.action, a.target, a.meta, a.actor_id from audit_log a where a.org_id = $1 and ($2::bigint is null or a.id < $2) and ($3 = '' or a.action like $3 || '%') order by a.id desc limit 1000`, [orgId, before, like])).rows));
  const ids = [...new Set(rows.map(r => r.actor_id).filter(Boolean))], names = ids.length ? (await pool.query('select id, name, email from "user" where id = any($1)', [ids])).rows : [], byId = Object.fromEntries(names.map(n => [n.id, n]));
  let out = rows.map(r => ({ id: Number(r.id), at: r.at, action: r.action, target: r.target, meta: r.meta, actor: r.actor_id ? (byId[r.actor_id]?.email || 'a former member') : 'EffDesk', actorName: r.actor_id ? (byId[r.actor_id]?.name || '') : 'EffDesk' }));
  if (who) out = out.filter(r => String(r.actor).toLowerCase().includes(who) || String(r.actorName).toLowerCase().includes(who));
  const page = out.slice(0, limit);
  return { ok: true, entries: page, next: out.length > limit ? page[page.length - 1].id : null };
}
export async function auditCsv(pool, orgId, b) {
  const all = []; let before = null;
  for (let i = 0; i < 20; i++) { const r = await listAudit(pool, orgId, { ...b, limit: 200, before }); all.push(...r.entries); if (!r.next) break; before = r.next; }
  return { ok: true, filename: 'effdesk-audit-log.csv', csv: toCsv(['at', 'actor', 'action', 'target', 'details'], all.map(e => ({ at: new Date(e.at).toISOString(), actor: e.actor, action: e.action, target: e.target || '', details: JSON.stringify(e.meta || {}) }))), truncated: all.length >= 4000 };
}
const PART = 300;
export async function exportInfo(pool, orgId) {
  const n = await withOrg(pool, orgId, async c => (await c.query('select count(*)::int n, coalesce(max(number),0)::int top from tickets where org_id = $1', [orgId])).rows[0]);
  return { ok: true, tickets: n.n, parts: Math.max(1, Math.ceil(n.n / PART)), partSize: PART };
}
// everything the organization holds, in parts of 300 tickets (part 1 also holds the settings, clients, macros and articles)
export async function exportData(pool, orgId, part = 1) {
  part = Math.max(1, Math.floor(Number(part)) || 1);
  return withOrg(pool, orgId, async c => {
    const Q = async (sql, p = [orgId]) => (await c.query(sql, p)).rows;
    const tks = await Q(`select id, number, subject, status, priority, type, channel, requester_name, requester_email, assignee_id, tags, cc, queue_id, client_id, merged_into, created_at, solved_at, first_response_at from tickets where org_id = $1 order by number offset ${(part - 1) * PART} limit ${PART}`);
    const ids = tks.map(t => t.id);
    const msgs = ids.length ? await Q('select ticket_id, kind, author_name, body, created_at from ticket_messages where org_id = $1 and ticket_id = any($2) order by created_at, id', [orgId, ids]) : [];
    const by = {}; for (const m of msgs) (by[m.ticket_id] = by[m.ticket_id] || []).push({ kind: m.kind, author: m.author_name, body: m.body, at: m.created_at });
    const out = { exportedAt: new Date().toISOString(), part, partSize: PART, tickets: tks.map(({ id, ...t }) => ({ ...t, messages: by[id] || [] })) };
    if (part === 1) {
      out.organization = (await pool.query('select id, name, slug from "organization" where id = $1', [orgId])).rows[0];
      out.clients = await Q('select name, domain, notes, share_tickets, created_at from clients where org_id = $1 order by name');
      out.queues = await Q('select id, name from queues where org_id = $1 order by name');
      out.macros = await Q('select name, body, status, priority, add_tags from macros where org_id = $1 order by name');
      out.articles = await Q('select group_id, lang, slug, title, body, status, created_at, updated_at from help_articles where org_id = $1 order by group_id, lang');
    }
    return { ok: true, filename: `effdesk-export-part-${part}.json`, json: JSON.stringify(out, null, 2), part, tickets: tks.length };
  });
}
export async function ticketsCsv(pool, orgId) {
  const rows = await withOrg(pool, orgId, async c => (await c.query('select number, subject, status, priority, type, channel, requester_name, requester_email, array_to_string(tags, \';\') as tags, created_at, first_response_at, solved_at from tickets where org_id = $1 order by number', [orgId])).rows);
  return { ok: true, filename: 'effdesk-tickets.csv', csv: toCsv(['number', 'subject', 'status', 'priority', 'type', 'channel', 'requester_name', 'requester_email', 'tags', 'created_at', 'first_response_at', 'solved_at'], rows.map(r => ({ ...r, created_at: r.created_at && new Date(r.created_at).toISOString(), first_response_at: r.first_response_at && new Date(r.first_response_at).toISOString(), solved_at: r.solved_at && new Date(r.solved_at).toISOString() }))) };
}
