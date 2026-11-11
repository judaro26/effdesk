// src/help.js: THE HELP CENTER: articles (draft or published, English or Spanish, linked as translations), search, votes, and a safe renderer for the article text.
import crypto from 'crypto';
import { withOrg } from './db.js';
import { clean as cleanHtml, plainOf } from './html-clean.js';
import { getEntitlements } from './billing.js';
import { themeIsFree } from './themes.js';
import { has as planHas } from './plans.js';

export const LANGS = ['en', 'es'];
const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400) => ({ ok: false, status, error });
export const slugify = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'article';
const cols = 'id, group_id, lang, slug, title, status, views, helpful_yes, helpful_no, created_at, updated_at, format, category';

export async function orgBySlug(pool, slug) { return (await pool.query('select id, name, slug from "organization" where slug = $1', [String(slug || '').toLowerCase()])).rows[0] || null; }

// ---------- for agents ----------
export async function listArticles(pool, orgId) { return withOrg(pool, orgId, async c => ({ ok: true, articles: (await c.query(`select ${cols} from help_articles where org_id = $1 order by updated_at desc`, [orgId])).rows })); }
export async function getArticle(pool, orgId, id) { return withOrg(pool, orgId, async c => { const a = (await c.query(`select ${cols}, body from help_articles where org_id = $1 and id = $2`, [orgId, String(id)])).rows[0]; return a ? { ok: true, article: a } : fail('No such article.', 404); }); }
// create (no id) or update; translationOf = the id of the article in another language this one translates
export async function saveArticle(pool, orgId, actor, input) {
  const html = input.format === 'html', title = clean(input.title, 200), category = clean(input.category, 60), body = html ? cleanHtml(String(input.body || '').replace(/\u0000/g, '').slice(0, 400000)).trim().slice(0, 200000) : String(input.body || '').replace(/\u0000/g, '').trim().slice(0, 50000), plain = html ? plainOf(body).slice(0, 50000) : body, lang = LANGS.includes(input.lang) ? input.lang : 'en', status = input.status === 'published' ? 'published' : 'draft';
  if (!title) return fail('Give the article a title.'); if (!body || (html && !plain && !/<(img|iframe|video)\b/.test(body))) return fail('Write the article.');
  return withOrg(pool, orgId, async c => {
    let existing = null; if (input.id) { existing = (await c.query('select id, group_id, lang, slug from help_articles where org_id = $1 and id = $2 for update', [orgId, String(input.id)])).rows[0]; if (!existing) return fail('No such article.', 404); }
    let group = existing ? existing.group_id : crypto.randomUUID();
    if (!existing && input.translationOf) { const src = (await c.query('select group_id, lang from help_articles where org_id = $1 and id = $2', [orgId, String(input.translationOf)])).rows[0]; if (!src) return fail('The article to translate does not exist.'); if (src.lang === lang) return fail('A translation must be in a different language.'); group = src.group_id; }
    if (existing && lang !== existing.lang) return fail('The language of an article cannot change. Create a translation instead.');
    if ((await c.query('select 1 from help_articles where org_id = $1 and group_id = $2 and lang = $3 and ($4::text is null or id <> $4)', [orgId, group, lang, existing ? existing.id : null])).rowCount) return fail('That article already has a version in this language.', 409);
    if (existing) { await c.query('update help_articles set title = $3, body = $4, status = $5, format = $6, category = $7, plain = $8, updated_at = now() where org_id = $1 and id = $2', [orgId, existing.id, title, body, status, html ? 'html' : 'text', category, plain]); return { ok: true, id: existing.id, slug: existing.slug }; }
    const id = crypto.randomUUID(); let slug = slugify(title), n = 1;
    while ((await c.query('select 1 from help_articles where org_id = $1 and slug = $2 and lang = $3', [orgId, slug, lang])).rowCount) slug = slugify(title).slice(0, 74) + '-' + (++n);
    await c.query('insert into help_articles (id, org_id, group_id, lang, slug, title, body, status, created_by, format, category, plain) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [id, orgId, group, lang, slug, title, body, status, actor.id, html ? 'html' : 'text', category, plain]);
    return { ok: true, id, slug };
  });
}
export async function deleteArticle(pool, orgId, id) { return withOrg(pool, orgId, async c => (await c.query('delete from help_articles where org_id = $1 and id = $2', [orgId, String(id)])).rowCount > 0); }

// ---------- public ----------
export async function publishedList(pool, orgId, lang) {
  return withOrg(pool, orgId, async c => (await c.query(`select id, group_id, lang, slug, title, category, views, left(coalesce(plain, body), 160) excerpt from help_articles where org_id = $1 and status = 'published' order by (lang = $2) desc, title`, [orgId, lang])).rows);
}
// the article in the wanted language, else any language, plus the other languages it exists in
export async function publicArticle(pool, orgId, slug, lang) {
  return withOrg(pool, orgId, async c => {
    const rows = (await c.query(`select id, group_id, lang, slug, title, body, format, category, updated_at from help_articles where org_id = $1 and slug = $2 and status = 'published'`, [orgId, String(slug)])).rows;
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
  return withOrg(pool, orgId, async c => (await c.query(`select id, lang, slug, title, category, left(coalesce(plain, body), 160) excerpt from help_articles where org_id = $1 and status = 'published' and (title ilike $2 or coalesce(plain, body) ilike $2) order by (title ilike $2) desc, (lang = $3) desc, helpful_yes desc limit 20`, [orgId, like, lang])).rows);
}

// ---------- the article text → safe HTML ----------
// Escape everything first, then allow: # ## ### headings, - or * lists, 1. lists, blank-line paragraphs, **bold**, *italic*, `code`, [text](https://link) and ```code blocks```.
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const IMG_OK = /^(https:\/\/[^\s)"'<>]+|\/help\/[a-z0-9-]{1,60}\/img\/[a-f0-9-]{36})$/;
const inline = t => esc(t).replace(/!\[([^\]]{0,200})\]\(([^\s)]+)\)/g, (m, alt, src) => IMG_OK.test(src.replace(/&amp;/g, '&')) ? `<img src="${src}" alt="${alt}" loading="lazy">` : m).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, (m, text, href) => `<a href="${href}" rel="nofollow noopener noreferrer">${text}</a>`);
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

// ---------- the help center's look (theme, accent colour, hero text) ----------
export async function getHelpSettings(pool, orgId) {
  const r = await withOrg(pool, orgId, async c => (await c.query('select theme, accent, hero_title, hero_subtitle from help_settings where org_id = $1', [orgId])).rows[0]);
  return r || { theme: 'classic', accent: '', hero_title: '', hero_subtitle: '' };
}
// what visitors get: a premium theme or accent only while the plan includes themes
export async function effectiveHelpSettings(pool, orgId) { const st = await getHelpSettings(pool, orgId), ent = await getEntitlements(pool, orgId), paid = planHas(ent, 'themes'); return { ...st, theme: paid || themeIsFree(st.theme) ? st.theme : 'classic', accent: paid ? st.accent : '', paid, status: planHas(ent, 'queues') }; }
export async function saveHelpSettings(pool, orgId, ent, input) {
  const theme = clean(input.theme, 20) || 'classic', paid = planHas(ent, 'themes');
  if (!/^(classic|midnight|mint|aurora|sunset|forest|ocean|orchid|obsidian|champagne)$/.test(theme)) return fail('That theme does not exist.');
  if (!themeIsFree(theme) && !paid) return { ok: false, status: 402, error: 'That theme is part of the Team plan. Upgrade to use it.', upgrade: true };
  const accent = clean(input.accent, 7); if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) return fail('The accent colour is a six-digit hex code like #2f6fed.'); if (accent && !paid) return { ok: false, status: 402, error: 'A custom accent colour is part of the Team plan.', upgrade: true };
  await withOrg(pool, orgId, c => c.query('insert into help_settings (org_id, theme, accent, hero_title, hero_subtitle) values ($1,$2,$3,$4,$5) on conflict (org_id) do update set theme = $2, accent = $3, hero_title = $4, hero_subtitle = $5, updated_at = now()', [orgId, theme, accent, clean(input.heroTitle, 100), clean(input.heroSubtitle, 200)]));
  return { ok: true };
}

// ---------- pictures used in articles ----------
const IMAGE_TYPES = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
export const MAX_IMAGE = 4 * 1024 * 1024;
export function sniffImage(b) { if (!b || b.length < 12) return null; if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return IMAGE_TYPES.png; if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return IMAGE_TYPES.jpeg; if (b.slice(0, 3).toString() === 'GIF') return IMAGE_TYPES.gif; if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return IMAGE_TYPES.webp; return null; }
// the type comes from the bytes, never from what the browser said (so a script cannot be stored as a picture)
export async function saveHelpImage(pool, store, orgId, bytes) {
  if (!bytes || !bytes.length) return fail('That file is empty.'); if (bytes.length > MAX_IMAGE) return fail('Pictures can be up to 4 MB each.', 413);
  const type = sniffImage(bytes); if (!type) return fail('Use a PNG, JPEG, GIF or WebP picture.', 415);
  const { storageUsed, limitForOrg } = await import('./attachments.js'); if ((await storageUsed(pool, orgId)) + bytes.length > (await limitForOrg(pool, orgId))) return { ok: false, status: 402, error: 'Your storage is full. Delete files or upgrade.' };
  const id = crypto.randomUUID(); await store.set(`${orgId}/help/${id}`, bytes);
  await withOrg(pool, orgId, c => c.query('insert into help_images (id, org_id, content_type, size) values ($1,$2,$3,$4)', [id, orgId, type, bytes.length]));
  return { ok: true, id, type };
}
export async function readHelpImage(pool, store, orgId, id) {
  if (!/^[a-f0-9-]{36}$/.test(String(id))) return null;
  const row = await withOrg(pool, orgId, async c => (await c.query('select content_type from help_images where org_id = $1 and id = $2', [orgId, id])).rows[0]); if (!row) return null;
  const bytes = await store.get(`${orgId}/help/${id}`); return bytes ? { type: row.content_type, bytes } : null;
}
