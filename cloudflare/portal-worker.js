// cloudflare/portal-worker.js: <slug>.effdesk.com SHOWS THAT ORGANIZATION'S HELP CENTER AND PORTAL. Nothing is made per customer: the wildcard record and this one route cover every organization the moment it exists.
//   rooster.effdesk.com/a/x  ->  https://<ORIGIN_HOST>/help/rooster/a/x   (the page, links, forms, cookies and redirects are rewritten back, so the visitor only ever sees rooster.effdesk.com)
// Variables: PORTAL_DOMAIN (effdesk.com), ORIGIN_HOST (the Netlify site, e.g. effdesk.netlify.app), PORTAL_PROXY_SECRET (secret; the app only trusts the host we send when this matches).
// <slug>.effdesk.com/agent/<number>/tickets is that workspace's agent desk (see isDeskPath).
// Route: *.effdesk.com/*  (names such as app, in, www go straight through untouched).
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'help', 'mail', 'in', 'smtp', 'imap', 'pop', 'ftp', 'status', 'blog', 'docs', 'support', 'billing', 'sales', 'login', 'signin', 'signup', 'auth']);
export const slugOf = (host, domain) => { const h = String(host || '').toLowerCase().replace(/:\d+$/, ''), d = String(domain || '').toLowerCase(); if (!d || !h.endsWith('.' + d)) return null; const s = h.slice(0, -d.length - 1); return /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])$/.test(s) && !RESERVED.has(s) ? s : null; };
export const stripBase = (text, slug) => String(text).split(`/help/${slug}`).join('');             // "/help/rooster/a" -> "/a", "/help/rooster" -> ""
export const fixLocation = (loc, slug, originHost, publicOrigin) => { let v = String(loc || ''); if (v.startsWith('https://' + originHost)) v = v.slice(('https://' + originHost).length); if (v.startsWith('/help/' + slug)) return (publicOrigin ? '' : '') + (stripBase(v, slug) || '/'); return v; };
export const fixCookie = c => String(c).replace(/;\s*Path=\/help\b[^;]*/i, '; Path=/');
// the agent desk on a workspace address: these paths go to the app untouched (sign-in, desk, API, scripts), everything else is the customer help center. The sign-in cookie the app sets has no Domain, so it belongs to that one address only.
export const isDeskPath = p => /^\/(agent(\/|$)|desk\.html$|auth\.html$|app\.html$|welcome\.html$|accept-invitation|api\/|js\/|css\/|brand\/|apple-touch-icon|favicon|robots\.txt$)/.test(p);
async function passDesk(request, url, env, fetchFn) {
  const publicOrigin = 'https://' + url.hostname, h = new Headers(request.headers); h.set('host', env.ORIGIN_HOST); h.set('x-forwarded-host', url.hostname); h.delete('x-effdesk-client-ip'); if (request.headers.get('cf-connecting-ip')) h.set('x-effdesk-client-ip', request.headers.get('cf-connecting-ip')); h.delete('cf-connecting-ip');
  if (h.get('origin')) h.set('origin', 'https://' + env.ORIGIN_HOST); if (h.get('referer')) h.set('referer', h.get('referer').split(publicOrigin).join('https://' + env.ORIGIN_HOST));
  const res = await fetchFn(`https://${env.ORIGIN_HOST}${url.pathname}${url.search}`, { method: request.method, headers: h, redirect: 'manual', body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() });
  const out = new Headers(res.headers), loc = out.get('location'); if (loc && loc.startsWith('https://' + env.ORIGIN_HOST)) out.set('location', publicOrigin + loc.slice(('https://' + env.ORIGIN_HOST).length));
  return new Response(res.body, { status: res.status, headers: out });
}
export async function handle(request, env, fetchFn = fetch) {
  const url = new URL(request.url), slug = slugOf(url.hostname, env.PORTAL_DOMAIN);
  if (!slug) return fetchFn(request);                                                              // not a portal name: leave it alone
  if (!env.ORIGIN_HOST || !env.PORTAL_PROXY_SECRET) return new Response('Portal is not configured.', { status: 503 });
  if (isDeskPath(url.pathname)) return passDesk(request, url, env, fetchFn);
  // an old-style address such as rooster.effdesk.com/help/rooster would be sent on as /help/rooster/help/rooster: send visitors to the clean address instead
  if ((request.method === 'GET' || request.method === 'HEAD') && (url.pathname === '/help/' + slug || url.pathname.startsWith('/help/' + slug + '/'))) return new Response(null, { status: 301, headers: { Location: (url.pathname.slice(('/help/' + slug).length) || '/') + url.search, 'Cache-Control': 'no-store' } });
  const publicOrigin = 'https://' + url.hostname, path = '/help/' + slug + (url.pathname === '/' ? '' : url.pathname);
  const h = new Headers(request.headers); h.set('host', env.ORIGIN_HOST); h.set('x-effdesk-portal', publicOrigin); h.set('x-effdesk-secret', env.PORTAL_PROXY_SECRET); h.delete('cf-connecting-ip');
  if (h.get('origin')) h.set('origin', 'https://' + env.ORIGIN_HOST);
  const init = { method: request.method, headers: h, redirect: 'manual', body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer() };
  const res = await fetchFn(`https://${env.ORIGIN_HOST}${path}${url.search}`, init);
  const out = new Headers(res.headers); out.delete('set-cookie');
  (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach(c => out.append('set-cookie', fixCookie(c)));
  if (out.get('location')) out.set('location', fixLocation(out.get('location'), slug, env.ORIGIN_HOST, publicOrigin));
  const type = out.get('content-type') || '';
  if (/text\/html/.test(type)) { const body = stripBase(await res.text(), slug) .split('href=""').join('href="/"').split('action=""').join('action="/"'); out.delete('content-length'); return new Response(body, { status: res.status, headers: out }); }
  return new Response(res.body, { status: res.status, headers: out });
}
export default { fetch: (request, env) => handle(request, env) };
