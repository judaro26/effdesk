// src/guard.js: SMALL SECURITY HELPERS used by the handlers.
import dns from 'node:dns/promises';
import net from 'node:net';
import https from 'node:https';
import { Readable } from 'node:stream';

export function clientIp(req, env = process.env) {
  const h = n => String(req.headers.get(n) || '').trim();
  const sec = env.PORTAL_PROXY_SECRET;
  if (sec && h('x-effdesk-secret') === sec && h('x-effdesk-client-ip')) return h('x-effdesk-client-ip').slice(0, 64);
  if (h('x-nf-client-connection-ip')) return h('x-nf-client-connection-ip').slice(0, 64);
  const parts = h('x-forwarded-for').split(',').map(s => s.trim()).filter(Boolean);
  return (parts.length ? parts[parts.length - 1] : 'unknown').slice(0, 64);
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
    if (Math.random() < 0.01) pool.query("delete from rate_hits where created_at < now() - interval '2 days'").catch(() => {});
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

async function resolvedPublicAddresses(hostname, lookup = dns.lookup) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return [];
  if (net.isIP(h)) return privateIp(h) ? [] : [{ address: h, family: net.isIP(h) }];
  const all = await lookup(h, { all: true, verbatim: true });
  return Array.isArray(all) && all.length && all.every(a => a?.address && !privateIp(a.address)) ? all : [];
}

export async function publicAddress(hostname, lookup = dns.lookup, { allowUnresolved = false } = {}) {
  try { return (await resolvedPublicAddresses(hostname, lookup)).length > 0; }
  catch { return allowUnresolved; }
}

// Use the exact address that was checked above for the socket connection. Keep the
// original hostname for HTTP Host and TLS certificate/SNI validation.
function pinnedLookup(address) {
  const family = net.isIP(address);
  return (_hostname, options, callback) => {
    if (options?.all) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

function requestPinnedHttps(u, init, address, requestFn) {
  return new Promise((resolve, reject) => {
    const headers = new Headers(init.headers || {});
    headers.delete('host');
    const options = {
      protocol: 'https:',
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || 443,
      path: u.pathname + u.search,
      method: String(init.method || 'GET').toUpperCase(),
      headers: Object.fromEntries(headers.entries()),
      lookup: pinnedLookup(address),
      ...(net.isIP(u.hostname.replace(/^\[|\]$/g, '')) ? {} : { servername: u.hostname }),
      ...(init.signal ? { signal: init.signal } : {}),
    };
    const req = requestFn(options, res => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(res.headers || {})) {
        if (Array.isArray(value)) for (const item of value) responseHeaders.append(name, item);
        else if (value !== undefined) responseHeaders.set(name, String(value));
      }
      const status = res.statusCode || 502;
      const body = status === 204 || status === 304 || options.method === 'HEAD' ? null : Readable.toWeb(res);
      resolve(new Response(body, { status, statusText: res.statusMessage || '', headers: responseHeaders }));
    });
    req.once('error', reject);
    const body = init.body;
    if (body !== undefined && body !== null) {
      if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) req.write(body);
      else { req.destroy(new TypeError('Unsupported outbound request body type.')); return; }
    }
    req.end();
  });
}

export async function guardedFetch(url, init = {}, { fetchFn, lookup, requestFn = https.request } = {}) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.username || u.password) throw Object.assign(new Error('Only public HTTPS destinations are allowed.'), { code: 'blocked' });
  const addresses = await resolvedPublicAddresses(u.hostname, lookup);
  if (!addresses.length) throw Object.assign(new Error('That address is not on the public internet.'), { code: 'blocked' });
  // fetchFn is an explicit test seam; production requests use the pinned HTTPS socket below.
  if (fetchFn) return fetchFn(url, { ...init, redirect: 'manual' });
  return requestPinnedHttps(u, init, addresses[0].address, requestFn);
}
