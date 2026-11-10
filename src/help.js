// src/help.js: THE HELP CENTER: articles (draft or published, English or Spanish, linked as translations), search, votes, and a safe renderer for the article text.
import crypto from 'crypto';
import { withOrg } from './db.js';

export const LANGS = ['en', 'es'];
const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400) => ({ ok: false, status, error });
export const slugify = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
const cols = 'id, group_id, lang, slug, title, status, views, helpful_yes, helpful_no, created_at, updated_at';

export async function orgBySlug(pool, slug) { return (await pool.query('select id, name, slug from "organization" where slug = $1', [String(slug || '').toLowerCase()])).rows[0] || null; }

// ---------- for agents ----------
export async function listArticles(pool, orgId) { return withOrg(pool, orgId, async c => ({ ok: true, articles: (await c.query(`select ${cols} from help_articles where org_id = $1 order by updated_at desc`, [orgId])).rows })); }
export async function getArticle(pool, orgId, id) { return withOrg(pool, orgId, async c => { const a = (await c.query(`select ${cols}, body from help_articles where org_id = $1 and id = $2`, [orgId, String(id)])).rows[0]; return a ? { ok: true, article: a } : fail('No such article.', 404); }); }
// create (no id) or update; translationOf = the id of the article in another language this one translates
export async function saveArticle(pool, orgId, actor, input) {
  const title = clean(input.title, 200), body = String(input.body || '').replace(/\u0000/g, '').trim().slice(0, 50000), lang = LANGS.includes(input.lang) ? input.lang : 'en', status = input.status === 'published' ? 'published' : 'draft';
  if (!title) return fail('Give the article a title.'); if (!body) return fail('Write the article.');
  return withOrg(pool, orgId, async c => {
    let existing = null; if (input.id) { existing = (await c.query('select id, group_id, lang, slug from help_articles where org_id = $1 and id = $2 for update', [orgId, String(input.id)])).rows[0]; if (!existing) return fail('No such article.', 404); }
    let group = existing ? existing.group_id : crypto.randomUUID();
    if (!existing && input.translationOf) { const src = (await c.query('select group_id, lang from help_articles where org_id = $1 and id = $2', [orgId, String(input.translationOf)])).rows[0]; if (!src) return fail('The article to translate does not exist.'); if (src.lang === lang) return fail('A translation must be in a different language.'); group = src.group_id; }
    if (existing && lang !== existing.lang) return fail('The language of an article cannot change. Create a translation instead.');
    if ((await c.query('select 1 from help_articles where org_id = $1 and group_id = $2 and lang = $3 and ($4::text is null or id <> $4)', [orgId, group, lang, existing ? existing.id : null])).rowCount) return fail('That article already has a version in this language.', 409);
    if (existing) { await c.query('update help_articles set title = $3, body = $4, status = $5, updated_at = now() where org_id = $1 and id = $2', [orgId, existing.id, title, body, status]); return { ok: true, id: existing.id, slug: existing.slug }; }
    const id = crypto.randomUUID(); let slug = slugify(title), n = 1;
    while ((await c.query('select 1 from help_articles where org_id = $1 and slug = $2 and lang = $3', [orgId, slug, lang])).rowCount) slug = slugify(title).slice(0, 74) + '-' + (++n);
    await c.query('insert into help_articles (id, org_id, group_id, lang, slug, title, body, status, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [id, orgId, group, lang, slug, title, body, status, actor.id]);
    return { ok: true, id, slug };
  });
}
export async function deleteArticle(pool, orgId, id) { return withOrg(pool, orgId, async c => (await c.query('delete from help_articles where org_id = $1 and id = $2', [orgId, String(id)])).rowCount > 0); }

// ---------- public ----------
export async function publishedList(pool, orgId, lang) {
  return withOrg(pool, orgId, async c => (await c.query(`select id, group_id, lang, slug, title, left(body, 160) excerpt from help_articles where org_id = $1 and status = 'published' order by (lang = $2) desc, title`, [orgId, lang])).rows);
}
// the article in the wanted language, else any language, plus the other languages it exists in
export async function publicArticle(pool, orgId, slug, lang) {
  return withOrg(pool, orgId, async c => {
    const rows = (await c.query(`select id, group_id, lang, slug, title, body, updated_at from help_articles where org_id = $1 and slug = $2 and status = 'published'`, [orgId, String(slug)])).rows;
    const a = rows.find(r => r.lang === lang) || rows[0]; if (!a) return null;
    const mine = (await c.query(`select lang, slug, title from help_articles where org_id = $1 and group_id = $2 and status = 'published'`, [orgId, a.group_id])).rows;
    const wanted = mine.find(m => m.lang === lang);
    return { article: a, translations: mine.filter(m => m.lang !== a.lang), better: wanted && wanted.lang !== a.lang ? wanted : null };
  });
}
export async function countView(pool, orgId, id) { await withOrg(pool, orgId, c => c.query('update help_articles set views = views + 1 where org_id = $1 and id = $2', [orgId, id])); }
export async function vote(pool, orgId, id, yes) { return withOrg(pool, orgId, async c => (await c.query(`update help_articles set ${yes ? 'helpful_yes = helpful_yes + 1' : 'helpful_no = helpful_no + 1'} where org_id = $1 and id = $2 and status = 'published'`, [orgId, String(id)])).rowCount > 0); }
export async function searchArticles(pool, orgId, q, lang) {
  const text = clean(q, 100); if (text.length < 2) return [];
  const like = '%' + text.replace(/[\\%_]/g, m => '\\' + m) + '%';
  return withOrg(pool, orgId, async c => (await c.query(`select id, lang, slug, title, left(body, 160) excerpt from help_articles where org_id = $1 and status = 'published' and (title ilike $2 or body ilike $2) order by (title ilike $2) desc, (lang = $3) desc, helpful_yes desc limit 20`, [orgId, like, lang])).rows);
}

// ---------- the article text → safe HTML ----------
// Escape everything first, then allow: # ## ### headings, - or * lists, 1. lists, blank-line paragraphs, **bold**, *italic*, `code`, [text](https://link) and ```code blocks```.
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inline = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, text, href) => `<a href="${href}" rel="nofollow noopener noreferrer">${text}</a>`);
export function renderBody(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n'), out = []; let list = null, para = [], code = null;
  const flushP = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }, flushL = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    if (code) { if (/^```/.test(raw)) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = null; } else code.push(raw); continue; }
    if (/^```/.test(raw)) { flushP(); flushL(); code = []; continue; }
    let m;
    if (!raw.trim()) { flushP(); flushL(); }
    else if ((m = raw.match(/^(#{1,3})\s+(.+)$/))) { flushP(); flushL(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = raw.match(/^\s*[-*]\s+(.+)$/))) { flushP(); if (list !== 'ul') { flushL(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else if ((m = raw.match(/^\s*\d+[.)]\s+(.+)$/))) { flushP(); if (list !== 'ol') { flushL(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); }
    else { flushL(); para.push(raw); }
  }
  if (code) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); flushP(); flushL(); return out.join('\n');
}
