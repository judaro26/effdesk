// src/guard.js: SMALL SECURITY HELPERS used by the handlers.
//   clientIp(req, env)        who is calling (headers a visitor cannot forge: Netlify's own, or the portal worker's when it proves itself with the shared secret)
//   sameOrigin(req)           false for a browser request that comes from another website or another subdomain (a cross-site request forgery guard for signed-in actions)
//   rateLimit(pool, key, max, seconds)   a counter in the database, shared by every function instance; true when the caller is over the limit. Fails open if the database cannot count.
//   publicAddress(hostname)   true only when every address the name resolves to is on the public internet (no loopback, private, link-local or metadata ranges)
//   guardedFetch(url, init)   fetch that refuses internal destinations and never follows redirects (a redirect could lead inside)
import dns from 'node:dns/promises';
import net from 'node:net';

export function clientIp(req, env = process.env) {
  const h = n => String(req.headers.get(n) || '').trim();
  const sec = env.PORTAL_PROXY_SECRET;
  if (sec && h('x-effdesk-secret') === sec && h('x-effdesk-client-ip')) return h('x-effdesk-client-ip').slice(0, 64);
  if (h('x-nf-client-connection-ip')) return h('x-nf-client-connection-ip').slice(0, 64);
  const parts = h('x-forwarded-for').split(',').map(s => s.trim()).filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : 'unknown').slice(0, 64);          // the last entry is the one our own edge added; the first is whatever the visitor claimed
}

export function sameOrigin(req) {
  const sfs = String(req.headers.get('sec-fetch-site') || '').toLowerCase();
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return false;
  const o = req.headers.get('origin');
  if (o) { if (o === 'null') return false; try { if (new URL(o).host !== new URL(req.url).host) return false; } catch { return false; } }
  return true;
}

export async function rateLimit(pool, key, max, seconds, now = Date.now()) {
  try {
    const win = Math.floor(now / (seconds * 1000));
    const n = (await pool.query('insert into rate_hits (key, win, n) values ($1,$2,1) on conflict (key, win) do update set n = rate_hits.n + 1 returning n', [String(key).slice(0, 200), win])).rows[0].n;
    if (Math.random() < 0.01) pool.query('delete from rate_hits where created_at < now() - interval \'2 days\'').catch(() => {});          // keeps the table small
    return n > max;
  } catch { return false; }
}

const v4 = ip => { const p = ip.split('.').map(Number); return p.length === 4 && p.every(x => x >= 0 && x <= 255) ? p : null; };
export function privateIp(ip) {
  ip = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (mapped) ip = mapped[1];
  if (net.isIPv4(ip)) {
    const [a, b] = v4(ip);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (net.isIPv6(ip)) return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip) || /^(64:ff9b|2001:db8|2002)/.test(ip);
  return true;
}
export async function publicAddress(hostname, lookup = dns.lookup, { allowUnresolved = false } = {}) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return false;
  if (net.isIP(h)) return !privateIp(h);
  try { const all = await lookup(h, { all: true }); return all.length > 0 && all.every(a => !privateIp(a.address)); } catch { return allowUnresolved; }
}
export async function guardedFetch(url, init = {}, { fetchFn = fetch, lookup } = {}) {
  const u = new URL(url);
  if (!(await publicAddress(u.hostname, lookup))) throw Object.assign(new Error('That address is not on the public internet.'), { code: 'blocked' });
  return fetchFn(url, { ...init, redirect: 'manual' });
}
