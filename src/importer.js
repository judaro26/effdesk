// src/importer.js: MOVING mdv's SUPPORT DATA IN. Reads the export of the old desk (tickets with their messages, help articles) and writes it into one organization. Repeating an import changes nothing that is already there (every row keeps its old id in source_id).
import crypto from 'crypto';
import { withOrg } from './db.js';
import { slugify } from './help.js';

const STATUS = { open: 'open', waiting: 'pending', hold: 'pending', solved: 'solved', cancelled: 'closed' };
const PRIORITY = new Set(['low', 'normal', 'high', 'urgent']);
const millis = v => { if (v && typeof v === 'object' && typeof v._seconds === 'number') return v._seconds * 1000; if (v && typeof v === 'object' && typeof v.seconds === 'number') return v.seconds * 1000; const t = typeof v === 'number' ? v : v ? new Date(v).getTime() : 0; return Number.isFinite(t) ? t : 0; };
const iso = (v, dflt) => new Date(millis(v) || dflt || Date.now()).toISOString();
const text = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const tag = s => slugify(s).slice(0, 30);
export const MAX_BATCH = { tickets: 200, articles: 200 };

// data = { tickets: [...], articles: [...] } exactly as the export button of the old desk produces it
export async function importMdv(pool, orgId, data, { dryRun = false } = {}) {
  const tickets = Array.isArray(data && data.tickets) ? data.tickets : [], articles = Array.isArray(data && data.articles) ? data.articles : [];
  if (tickets.length > MAX_BATCH.tickets || articles.length > MAX_BATCH.articles) return { ok: false, status: 413, error: `Send at most ${MAX_BATCH.tickets} tickets and ${MAX_BATCH.articles} articles at a time.` };
  const sum = { tickets: { added: 0, existing: 0, skipped: 0 }, messages: 0, articles: { added: 0, existing: 0, skipped: 0 }, assigned: 0, unassigned: 0, filesNotCopied: 0, warnings: [] };
  const warn = w => { if (sum.warnings.length < 30) sum.warnings.push(w); };
  const members = new Map((await pool.query('select lower(u.email) email, u.id from member m join "user" u on u.id = m."userId" where m."organizationId" = $1', [orgId])).rows.map(r => [r.email, r.id]));
  const run = async c => {
    let maxNumber = 0;
    for (const t of tickets) {
      const sid = 'mdv:' + text(t && t.id, 80), subject = text(t && t.subject, 200), email = text(t && t.requester && t.requester.email, 254).toLowerCase();
      if (!t || !t.id || !subject || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { sum.tickets.skipped++; warn(`Ticket ${text(t && (t.number || t.id), 40)} skipped: it needs an id, a subject and a requester email.`); continue; }
      if ((await c.query('select 1 from tickets where org_id = $1 and source_id = $2', [orgId, sid])).rowCount) { sum.tickets.existing++; continue; }
      let number = Number(t.number) > 0 ? Number(t.number) : 0;
      if (!number || (await c.query('select 1 from tickets where org_id = $1 and number = $2', [orgId, number])).rowCount) { number = (await c.query('select greatest(coalesce(max(number), 0), coalesce((select last_number from ticket_counters where org_id = $1), 0)) + 1 n from tickets where org_id = $1', [orgId])).rows[0].n; warn(`Ticket ${text(t.number, 20)} got the new number ${number} (the old number was missing or already used).`); }
      maxNumber = Math.max(maxNumber, number);
      const msgs = (Array.isArray(t.messages) ? t.messages : []).filter(m => m && text(m.body, 20000)), createdMs = millis(t.createdAt) || Date.now();
      const firstAgent = msgs.find(m => m.by === 'agent' && m.internal !== true), assignee = t.assignee && t.assignee.email ? members.get(String(t.assignee.email).toLowerCase()) || null : null;
      if (t.assignee && t.assignee.email) assignee ? sum.assigned++ : sum.unassigned++;
      const tags = [...new Set([...(Array.isArray(t.labels) ? t.labels.map(tag) : []), t.category ? 'cat-' + tag(t.category) : '', t.status === 'hold' ? 'on-hold' : '', t.workspaceName ? 'ws-' + tag(t.workspaceName) : ''].filter(Boolean))].slice(0, 20);
      const status = STATUS[t.status] || 'open', solvedMs = millis(t.solvedAt) || (status === 'solved' || status === 'closed' ? millis(t.updatedAt) : 0);
      if (dryRun) { sum.tickets.added++; sum.messages += msgs.length; continue; }
      const row = (await c.query('insert into tickets (org_id, number, subject, status, priority, channel, requester_name, requester_email, assignee_id, tags, first_response_at, solved_at, created_at, updated_at, source_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id', [orgId, number, subject, status, PRIORITY.has(t.priority) ? t.priority : 'normal', 'web', text(t.requester.name, 100), email, assignee, tags, firstAgent ? iso(firstAgent.at) : null, solvedMs ? iso(solvedMs) : null, iso(createdMs), iso(t.updatedAt, createdMs), sid])).rows[0];
      let i = 0;
      for (const m of msgs) {
        const kind = m.by === 'agent' ? (m.internal === true ? 'note' : 'agent') : m.by === 'system' ? 'system' : 'requester';
        const mid = (await c.query('insert into ticket_messages (org_id, ticket_id, kind, author_name, body, created_at, source_id) values ($1,$2,$3,$4,$5,$6,$7) returning id', [orgId, row.id, kind, text(m.name || (kind === 'requester' ? email : ''), 100), text(m.body, 20000), iso(m.at, createdMs), `${sid}#${text(m.id, 60) || i}`])).rows[0].id;
        i++; sum.messages++;
        const files = (Array.isArray(m.files) ? m.files : []).map(f => text(f && f.name, 80)).filter(Boolean);
        if (files.length) { sum.filesNotCopied += files.length; await c.query("insert into ticket_messages (org_id, ticket_id, kind, body, created_at, source_id) values ($1,$2,'system',$3,$4,$5)", [orgId, row.id, `Files from the old desk, not copied: ${files.join(', ')}.`, iso(m.at, createdMs), `${sid}#${text(m.id, 60) || i}#files`]); }
      }
      sum.tickets.added++;
    }
    if (!dryRun && maxNumber) await c.query('insert into ticket_counters (org_id, last_number) values ($1,$2) on conflict (org_id) do update set last_number = greatest(ticket_counters.last_number, excluded.last_number)', [orgId, maxNumber]);
    const groups = new Map(), seen = new Set();
    for (const a of articles) {
      const sid = 'mdv:' + text(a && a.id, 80), title = text(a && a.title, 200), body = text(a && a.body, 50000), lang = a && a.lang === 'es' ? 'es' : 'en';
      if (!a || !a.id || !title || !body) { sum.articles.skipped++; warn(`An article was skipped: it needs an id, a title and text.`); continue; }
      if ((await c.query('select 1 from help_articles where org_id = $1 and source_id = $2', [orgId, sid])).rowCount) { sum.articles.existing++; continue; }
      const gkey = text(a.group, 80) || sid, taken = `${gkey}|${lang}`;
      if (seen.has(taken) || (!dryRun && (await c.query('select 1 from help_articles where org_id = $1 and source_group = $2 and lang = $3', [orgId, gkey, lang])).rowCount)) { sum.articles.skipped++; warn(`Article "${title}" skipped: its group already has a ${lang} version.`); continue; }
      seen.add(taken);
      if (dryRun) { sum.articles.added++; continue; }
      let group = groups.get(gkey);
      if (!group) { const prior = (await c.query('select group_id from help_articles where org_id = $1 and source_group = $2 limit 1', [orgId, gkey])).rows[0]; group = prior ? prior.group_id : crypto.randomUUID(); groups.set(gkey, group); }
      let slug = slugify(title), n = 1; while ((await c.query('select 1 from help_articles where org_id = $1 and slug = $2 and lang = $3', [orgId, slug, lang])).rowCount) slug = slugify(title).slice(0, 74) + '-' + (++n);
      await c.query('insert into help_articles (id, org_id, group_id, lang, slug, title, body, status, helpful_yes, helpful_no, created_at, updated_at, source_id, source_group) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)', [crypto.randomUUID(), orgId, group, lang, slug, title, body, a.published === true ? 'published' : 'draft', Math.max(0, Number(a.votesYes) || 0), Math.max(0, Number(a.votesNo) || 0), iso(a.createdAt), iso(a.updatedAt, millis(a.createdAt)), sid, gkey]);
      sum.articles.added++;
    }
  };
  await withOrg(pool, orgId, run);
  return { ok: true, dryRun, ...sum };
}
