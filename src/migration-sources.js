// src/migration-sources.js: PULLING TICKETS AND ARTICLES OUT OF ZENDESK OR FRESHDESK over their APIs, one page at a time, in the shape src/importer.js understands. The customer gives an account address and a token; nothing is stored (the token is sent with each step and used for that step only). Customers are never emailed: the importer writes straight to the database.
//   source(provider, creds, fetchFn).check()        -> { ok, total? }   are the credentials right
//   source(provider, creds, fetchFn).page(cursor)   -> { tickets, articles, next, progress }   next = null when everything is done
// A rate limit from the other side ends the step with { retryAfter } so the caller waits and repeats the same step.
const text = (v, n) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, n);
export class Wait extends Error { constructor(s) { super('rate limited'); this.retryAfter = s; } }
export class Bad extends Error { constructor(m, status = 400) { super(m); this.status = status; } }
const SUB = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UNKNOWN = id => `unknown+${id}@imported.invalid`;
export const PROVIDERS = ['zendesk', 'freshdesk'];

// article bodies arrive as HTML: keep the structure that EffDesk can show (bold, italic, links, lists, headings, line breaks), drop everything else
export function htmlToText(h) {
  let s = String(h == null ? '' : h).replace(/\r/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, u, t) => /^(https?:|mailto:)/i.test(u) ? `[${t.replace(/<[^>]+>/g, '')}](${u})` : t);
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**').replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '_$2_');
  s = s.replace(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi, '\n\n# $1\n\n').replace(/<h[4-6][^>]*>([\s\S]*?)<\/h[4-6]>/gi, '\n\n**$1**\n\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<\/(p|div|ul|ol|tr|table|blockquote)>/gi, '\n\n').replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function mapLimit(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }
const getter = (headers, fetchFn) => async url => {
  const r = await fetchFn(url, { headers: { ...headers, accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  if (r.status === 429) throw new Wait(Math.min(Math.max(Number(r.headers.get('retry-after')) || 30, 5), 120));
  if (r.status === 401 || r.status === 403) throw new Bad('The provider refused those credentials. Check the address, the email and the token, and that API access is turned on.', 400);
  if (r.status === 404) throw new Bad('That account address was not found. Check the spelling.', 400);
  if (!r.ok) throw new Bad(`The provider answered with an error (${r.status}). Try again in a minute.`, 502);
  return r.json();
};

// ---------------- Zendesk ----------------
function zendesk(c, fetchFn) {
  const sub = String(c.subdomain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\.zendesk\.com.*$/, ''); if (!SUB.test(sub)) throw new Bad('Enter your Zendesk address, such as acme (from acme.zendesk.com).');
  const email = text(c.email, 254), token = text(c.token, 200); if (!email || !token) throw new Bad('Enter the admin email and the API token.');
  const base = `https://${sub}.zendesk.com`, get = getter({ authorization: 'Basic ' + Buffer.from(`${email}/token:${token}`).toString('base64') }, fetchFn);
  const STATUS = { new: 'open', open: 'open', pending: 'waiting', hold: 'hold', solved: 'solved', closed: 'cancelled' };
  return {
    async check() { const j = await get(`${base}/api/v2/tickets/count.json`); return { ok: true, total: Number(j.count && j.count.value) || 0 }; },
    async page(cur) {
      cur = cur || { phase: 'tickets' };
      if (cur.phase === 'articles') {
        const j = await get(cur.url || `${base}/api/v2/help_center/articles.json?per_page=40`);
        const articles = (j.articles || []).map(a => ({ id: String(a.id), title: a.title, body: htmlToText(a.body), lang: /^es/i.test(a.locale || '') ? 'es' : 'en', published: a.draft !== true, votesYes: Math.max(0, Number(a.vote_sum) || 0) }));
        return { tickets: [], articles, next: j.next_page ? { phase: 'articles', url: j.next_page } : null, progress: { phase: 'articles', fetched: articles.length } };
      }
      const j = await get(cur.after ? `${base}/api/v2/incremental/tickets/cursor.json?per_page=40&cursor=${encodeURIComponent(cur.after)}` : `${base}/api/v2/incremental/tickets/cursor.json?per_page=40&start_time=0`);
      const list = (j.tickets || []).filter(t => t.status !== 'deleted'), ids = [...new Set(list.flatMap(t => [t.requester_id, t.assignee_id]).filter(Boolean))];
      const users = new Map(); for (let i = 0; i < ids.length; i += 100) { const u = await get(`${base}/api/v2/users/show_many.json?ids=${ids.slice(i, i + 100).join(',')}`); (u.users || []).forEach(x => users.set(x.id, x)); }
      const tickets = await mapLimit(list, 6, async t => {
        const cj = await get(`${base}/api/v2/tickets/${t.id}/comments.json?include=users`); (cj.users || []).forEach(x => users.set(x.id, x));
        const req = users.get(t.requester_id) || {}, asg = users.get(t.assignee_id);
        return { id: String(t.id), number: t.id, subject: text(t.subject, 200) || '(no subject)', requester: { email: text(req.email, 254) || UNKNOWN('zd' + t.id), name: req.name || '' }, assignee: asg && asg.email ? { email: asg.email } : undefined, status: STATUS[t.status] || 'open', priority: t.priority || 'normal', labels: t.tags || [], createdAt: t.created_at, updatedAt: t.updated_at, solvedAt: t.status === 'solved' || t.status === 'closed' ? t.updated_at : undefined,
          messages: (cj.comments || []).map(m => { const au = users.get(m.author_id) || {}; return { id: String(m.id), by: au.role === 'end-user' ? 'requester' : 'agent', internal: m.public === false, name: au.name || '', at: m.created_at, body: text(m.plain_body || htmlToText(m.html_body) || m.body, 20000), files: (m.attachments || []).map(a => ({ name: a.file_name })) }; }) };
      });
      return { tickets, articles: [], next: j.end_of_stream ? { phase: 'articles' } : { phase: 'tickets', after: j.after_cursor }, progress: { phase: 'tickets', fetched: tickets.length } };
    },
  };
}

// ---------------- Freshdesk ----------------
function freshdesk(c, fetchFn) {
  const dom = String(c.domain || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\.freshdesk\.com.*$/, ''); if (!SUB.test(dom)) throw new Bad('Enter your Freshdesk address, such as acme (from acme.freshdesk.com).');
  const key = text(c.token, 200); if (!key) throw new Bad('Enter your API key (Profile settings in Freshdesk).');
  const base = `https://${dom}.freshdesk.com`, get = getter({ authorization: 'Basic ' + Buffer.from(`${key}:X`).toString('base64') }, fetchFn);
  const STATUS = { 2: 'open', 3: 'waiting', 4: 'solved', 5: 'cancelled' }, PRI = { 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' };
  const agents = async () => { const m = new Map(); for (let p = 1; p <= 10; p++) { const a = await get(`${base}/api/v2/agents?per_page=100&page=${p}`); a.forEach(x => m.set(x.id, { email: x.contact && x.contact.email, name: x.contact && x.contact.name })); if (a.length < 100) break; } return m; };
  return {
    async check() { await get(`${base}/api/v2/tickets?per_page=1`); return { ok: true }; },
    async page(cur) {
      cur = cur || { phase: 'tickets', page: 1 };
      if (cur.phase === 'articles') {
        const out = [], cats = await get(`${base}/api/v2/solutions/categories`);
        for (const cat of cats.slice(0, 50)) for (const f of (await get(`${base}/api/v2/solutions/categories/${cat.id}/folders`)).slice(0, 100)) {
          for (let p = 1; p <= 20; p++) { const arts = await get(`${base}/api/v2/solutions/folders/${f.id}/articles?per_page=100&page=${p}`); arts.forEach(a => out.push({ id: String(a.id), title: a.title, body: htmlToText(a.description), lang: 'en', published: a.status === 2, votesYes: Number(a.thumbs_up) || 0, votesNo: Number(a.thumbs_down) || 0 })); if (arts.length < 100) break; }
        }
        return { tickets: [], articles: out.slice(0, 200), next: null, progress: { phase: 'articles', fetched: out.length } };
      }
      const list = await get(`${base}/api/v2/tickets?include=requester&per_page=100&page=${cur.page}&order_by=created_at&order_type=asc&updated_since=2000-01-01T00:00:00Z`);
      const ag = await agents();
      const tickets = await mapLimit(list, 6, async t => {
        const conv = []; for (let p = 1; p <= 30; p++) { const x = await get(`${base}/api/v2/tickets/${t.id}/conversations?per_page=30&page=${p}`); conv.push(...x); if (x.length < 30) break; }
        const req = t.requester || {}, asg = ag.get(t.responder_id);
        const first = { id: 'description', by: 'requester', name: req.name || '', at: t.created_at, body: text(t.description_text || htmlToText(t.description), 20000) };
        return { id: String(t.id), number: t.id, subject: text(t.subject, 200) || '(no subject)', requester: { email: text(req.email, 254) || UNKNOWN('fd' + t.id), name: req.name || '' }, assignee: asg && asg.email ? { email: asg.email } : undefined, status: STATUS[t.status] || 'waiting', priority: PRI[t.priority] || 'normal', labels: t.tags || [], createdAt: t.created_at, updatedAt: t.updated_at, solvedAt: t.status === 4 || t.status === 5 ? t.updated_at : undefined,
          messages: [first].concat(conv.map(m => ({ id: String(m.id), by: m.incoming ? 'requester' : 'agent', internal: m.private === true, name: m.incoming ? (req.name || '') : (ag.get(m.user_id) || {}).name || '', at: m.created_at, body: text(m.body_text || htmlToText(m.body), 20000), files: (m.attachments || []).map(a => ({ name: a.name })) }))) };
      });
      return { tickets, articles: [], next: list.length < 100 ? { phase: 'articles' } : { phase: 'tickets', page: cur.page + 1 }, progress: { phase: 'tickets', fetched: tickets.length } };
    },
  };
}
export function source(provider, creds, fetchFn = fetch) {
  if (provider === 'zendesk') return zendesk(creds || {}, fetchFn);
  if (provider === 'freshdesk') return freshdesk(creds || {}, fetchFn);
  throw new Bad('Choose Zendesk or Freshdesk.');
}
