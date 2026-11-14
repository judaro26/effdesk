// scripts/test-guard.js: THE SECURITY HELPERS: forge-proof client address, cross-site refusal, shared rate limit, internal-address refusal for outbound calls, and the places that use them
import crypto from 'crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { clientIp, sameOrigin, rateLimit, privateIp, publicAddress, guardedFetch } from '../src/guard.js';
import { safeUrl, saveHook } from '../src/webhooks.js';

const R = (headers = {}, url = 'https://app.test/api/x', method = 'POST') => new Request(url, { method, headers });
check('the client address comes from Netlify, not from a header the visitor can write', clientIp(R({ 'x-nf-client-connection-ip': '1.2.3.4', 'x-forwarded-for': '6.6.6.6, 1.2.3.4' }), {}) === '1.2.3.4');
check('without it the LAST forwarded address is used, the one our own edge added', clientIp(R({ 'x-forwarded-for': '6.6.6.6, 9.9.9.9' }), {}) === '9.9.9.9');
check('the portal worker’s address counts only with the shared secret', clientIp(R({ 'x-effdesk-secret': 's3', 'x-effdesk-client-ip': '8.8.8.8', 'x-nf-client-connection-ip': '172.64.0.1' }), { PORTAL_PROXY_SECRET: 's3' }) === '8.8.8.8' && clientIp(R({ 'x-effdesk-secret': 'bad', 'x-effdesk-client-ip': '8.8.8.8', 'x-nf-client-connection-ip': '172.64.0.1' }), { PORTAL_PROXY_SECRET: 's3' }) === '172.64.0.1');
check('requests from our own pages pass, and so do tools with no browser headers', sameOrigin(R({ origin: 'https://app.test', 'sec-fetch-site': 'same-origin' })) && sameOrigin(R()));
check('a request another website or a sibling subdomain sends is refused', !sameOrigin(R({ origin: 'https://evil.test' })) && !sameOrigin(R({ 'sec-fetch-site': 'cross-site' })) && !sameOrigin(R({ 'sec-fetch-site': 'same-site', origin: 'https://mdv.effdesk.com' })) && !sameOrigin(R({ origin: 'null' })));
check('private, loopback, link-local, metadata and mapped addresses are internal', ['127.0.0.1', '10.1.2.3', '192.168.0.9', '172.16.5.5', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '[::1]'].every(privateIp));
check('public addresses are not', ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '172.32.0.1'].every(a => !privateIp(a)));
const fake = map => async h => { if (!(h in map)) throw new Error('ENOTFOUND'); return map[h].map(address => ({ address })); };
check('a name that points inside is refused, even though it looks public', !(await publicAddress('sneaky.example.org', fake({ 'sneaky.example.org': ['10.0.0.5'] }))) && !(await publicAddress('mixed.example.org', fake({ 'mixed.example.org': ['8.8.8.8', '127.0.0.1'] }))));
check('a name that points outside is fine, and an unknown name is refused unless allowed', (await publicAddress('ok.example.org', fake({ 'ok.example.org': ['8.8.8.8'] }))) && !(await publicAddress('nope.example.org', fake({}))) && (await publicAddress('nope.example.org', fake({}), { allowUnresolved: true })));
let called = 0; const fx = async () => { called++; return new Response('x'); };
let blocked = false; try { await guardedFetch('https://sneaky.example.org/hook', {}, { fetchFn: fx, lookup: fake({ 'sneaky.example.org': ['169.254.169.254'] }) }); } catch (e) { blocked = e.code === 'blocked'; }
check('the outbound call is not even made to an internal destination', blocked && called === 0);
await guardedFetch('https://ok.example.org/hook', { method: 'POST' }, { fetchFn: async (u, i) => { called++; check('and redirects are never followed', i.redirect === 'manual'); return new Response('x'); }, lookup: fake({ 'ok.example.org': ['8.8.8.8'] }) });
// Verify that production outbound requests use the already-validated IP address:
let pinnedOptions;
const pinned = await guardedFetch('https://hooks.example.org/notify', { method: 'POST', body: '{"ok":true}' }, {
  lookup: fake({ 'hooks.example.org': ['8.8.8.8', '1.1.1.1'] }),
  requestFn: (options, onResponse) => {
    pinnedOptions = options;
    const req = new EventEmitter();
    req.write = () => {};
    req.end = () => { const res = new PassThrough(); res.statusCode = 204; res.statusMessage = 'No Content'; res.headers = {}; onResponse(res); res.end(); };
    req.destroy = error => { if (error) req.emit('error', error); };
    return req;
  },
});
let pinnedAddress = '';
await new Promise((resolve, reject) => pinnedOptions.lookup('hooks.example.org', {}, (err, address) => { if (err) reject(err); else { pinnedAddress = address; resolve(); } }));
check('the socket is pinned to a validated DNS address while TLS and Host use the original hostname', pinnedOptions.hostname === 'hooks.example.org' && pinnedOptions.servername === 'hooks.example.org' && pinnedAddress === '8.8.8.8' && pinned.status === 204);
let mixedDnsBlocked = false, mixedDnsCalled = false;
try {
  await guardedFetch('https://mixed.example.org/notify', {}, {
    lookup: fake({ 'mixed.example.org': ['8.8.8.8', '127.0.0.1'] }),
    requestFn: () => { mixedDnsCalled = true; throw new Error('must not connect'); },
  });
} catch (e) { mixedDnsBlocked = e.code === 'blocked'; }
check('a mixed public/private DNS answer is blocked before opening a socket', mixedDnsBlocked && !mixedDnsCalled);

check('webhook addresses with a bare IP, a port or an internal name are refused', ['https://127.0.0.1/x', 'https://2130706433/x', 'https://[::1]/x', 'https://hooks.acme.io:8443/x', 'https://db.internal/x', 'http://hooks.acme.io/x'].every(u => safeUrl(u) === null));

const { url } = await freshDb('guard'); await migrate(url); const pool = makePool(url);
check('the shared limit lets the first calls through and stops the rest', await (async () => { const r = []; for (let i = 0; i < 5; i++) r.push(await rateLimit(pool, 'k1', 3, 60, 1000)); return r.join() === 'false,false,false,true,true'; })());
check('another caller, and the next window, start fresh', !(await rateLimit(pool, 'k2', 3, 60, 1000)) && !(await rateLimit(pool, 'k1', 3, 60, 1000 + 61000)));
const dead = { query: async () => { throw new Error('down'); } }; check('if the database cannot count, calls are let through rather than blocked', (await rateLimit(dead, 'k', 1, 60)) === false);
const hook = await saveHook(pool, (await (async () => { const id = crypto.randomUUID(); await pool.query('insert into "organization" (id, name, slug, "createdAt") values ($1,$2,$3, now())', [id, 'G', 'g' + id.slice(0, 6)]); return id; })()), { url: 'https://evil.example.org/h', events: ['ticket.created'] }, { lookup: fake({ 'evil.example.org': ['10.0.0.9'] }) });
check('saving a webhook whose name resolves to an internal address is refused', hook.ok === false && /public/.test(hook.error));
done();
