// scripts/test-sso.js: SINGLE SIGN-ON ON A REAL POSTGRES WITH A MOCK IDENTITY PROVIDER (real signed tokens): sign-in creates and signs in a person, and every way of cheating is refused.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets } from '../src/handlers.js';
import http from 'node:http';
import { SignJWT, generateKeyPair, exportJWK } from 'jose';
import { grantLicense } from '../src/license.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('sso'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); return { cookie, user: r.response.user, headers: new Headers({ cookie }) }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });
const tk = async (who, action, orgId, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const A = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const _unused = async n => (await A(olivia, 'get', { number: n })).body.messages;

await A(olivia, 'mail-save', { inbox: 'acme', replyMode: 'ticket', fromName: 'Acme' });

// ---- the mock identity provider ----
const { publicKey, privateKey } = await generateKeyPair('RS256'), jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const codes = new Map(); let issuer = '';
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url, issuer), send = (o, s = 200) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/openid-configuration') return send({ issuer, authorization_endpoint: issuer + '/authorize', token_endpoint: issuer + '/token', jwks_uri: issuer + '/jwks' });
  if (u.pathname === '/jwks') return send({ keys: [jwk] });
  if (u.pathname === '/token') { let b = ''; for await (const c of req) b += c; const f = new URLSearchParams(b), c = codes.get(f.get('code')); if (!c || f.get('client_secret') !== 'shh' || f.get('client_id') !== 'cid' || !f.get('code_verifier')) return send({ error: 'bad' }, 400);
    const jwt = await new SignJWT({ email: c.email, ...(c.omitEmailVerified ? {} : { email_verified: c.verified !== false }), name: c.name, nonce: c.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(c.iss || issuer).setAudience(c.aud || 'cid').setSubject(c.sub).setIssuedAt().setExpirationTime('5m').sign(privateKey); return send({ id_token: jwt, access_token: 'x' }); }
  send({}, 404);
});
await new Promise(r => idp.listen(0, '127.0.0.1', r)); issuer = 'http://127.0.0.1:' + idp.address().port;
const BASE = 'http://localhost:8888';
const T = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const cookieOf = res => res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
// walk the whole sign-in: start, "log in at the provider" (we fabricate the answer), callback
async function signIn(email, over = {}, startQuery = '?email=' + email) {
  const s = await auth.handler(new Request(BASE + '/api/auth/sso/start' + startQuery)), loc = new URL(s.headers.get('location'));
  if (!/127\.0\.0\.1/.test(loc.host)) return { start: s, loc: s.headers.get('location') };
  const code = 'c' + Math.random().toString(36).slice(2); codes.set(code, { email, sub: 'sub-' + email, name: 'Newbie', nonce: loc.searchParams.get('nonce'), ...over });
  const cb = await auth.handler(new Request(BASE + '/api/auth/sso/callback?code=' + code + '&state=' + (over.state || loc.searchParams.get('state')), { headers: { cookie: over.cookie !== undefined ? over.cookie : cookieOf(s) } }));
  return { start: s, loc, cb, to: cb.headers.get('location') || '' };
}
check('SSO needs the Pro plan and an admin', (await T(ann, 'sso-get')).status === 403);
check('nothing is set up at first', (await T(olivia, 'sso-get')).body.sso.configured === false && /sso_error/.test((await signIn('x@acme.test')).loc));
let r = await T(olivia, 'sso-save', { issuer, clientId: 'cid', clientSecret: 'shh', domains: 'acme.test, @Acme.Test', enabled: true, defaultRole: 'member' });
check('an admin saves the provider; domains are cleaned; the secret is never returned', r.status === 200 && r.body.sso.domains.join() === 'acme.test' && !JSON.stringify(r.body).includes('shh'));
check('the secret is stored encrypted', !(await pool.query('select client_secret_enc from sso_providers')).rows[0].client_secret_enc.includes('shh'));
check('a bad issuer or domain is refused', (await T(olivia, 'sso-save', { issuer: 'http://evil.example', clientId: 'a', clientSecret: 'b', domains: 'acme.test' })).status === 400 && (await T(olivia, 'sso-save', { issuer, clientId: 'a', clientSecret: 'b', domains: 'not a domain' })).status === 400);
r = await signIn('newbie@acme.test');
const sess = await auth.api.getSession({ headers: new Headers({ cookie: cookieOf(r.cb) }) });
check('a new person is created, made a member and signed in, and lands in the desk', /desk\.html/.test(r.to) && sess && sess.user.email === 'newbie@acme.test' && (await pool.query('select role from member where "userId" = $1 and "organizationId" = $2', [sess.user.id, acme.id])).rows[0].role === 'member');
r = await signIn('newbie@acme.test');
check('signing in again reuses the same person', (await pool.query("select count(*)::int n from \"user\" where email = 'newbie@acme.test'")).rows[0].n === 1 && /desk\.html/.test(r.to));
r = await signIn('stranger@other.test'); check('an address outside the domains has no SSO', /sso_error/.test(r.loc));
r = await signIn('mallory@acme.test', { email: 'mallory@evil.test' }); check('an email outside the company domains is refused even if the provider vouches for it', /sso_error/.test(r.to) && !/desk/.test(r.to));
r = await signIn('v@acme.test', { verified: false }); check('an unverified email is refused', /sso_error/.test(r.to));
r = await signIn('missing-verified@acme.test', { omitEmailVerified: true }); check('an ID token without an explicit email_verified=true claim is refused', /sso_error/.test(r.to));
r = await signIn('t@acme.test', { aud: 'someone-else' }); check('a token for another application is refused', /sso_error/.test(r.to));
r = await signIn('t@acme.test', { iss: 'http://127.0.0.1:1' }); check('a token from another issuer is refused', /sso_error/.test(r.to));
r = await signIn('t@acme.test', { nonce: 'wrong' }); check('a replayed token (wrong nonce) is refused', /sso_error/.test(r.to));
r = await signIn('t@acme.test', { state: 'forged' }); check('a wrong state is refused', /sso_error/.test(r.to));
r = await signIn('t@acme.test', { cookie: '' }); check('a callback without the cookie is refused', /sso_error/.test(r.to));
await signUp('existing@acme.test', 'Existing');
r = await signIn('existing@acme.test'); check('someone who already has an account and is not a member is not taken over', /sso_error/.test(r.to) && /invite/i.test(decodeURIComponent(r.to)));
await auth.api.addMember({ body: { userId: (await pool.query("select id from \"user\" where email = 'existing@acme.test'")).rows[0].id, role: 'member', organizationId: acme.id } });
r = await signIn('existing@acme.test'); check('once invited, that person signs in with SSO', /desk\.html/.test(r.to));
await grantLicense(pool, { orgId: beta.id, actorEmail: 'o@e.test', note: 't' });
check('another workspace cannot claim the same domain', (await tk(otto, 'sso-save', beta.id, { issuer, clientId: 'cid', clientSecret: 'shh', domains: 'acme.test' })).status === 409);
const pw = (email) => auth.handler(new Request(BASE + '/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email, password: PW }) }));
check('before "require SSO", the password still works', (await pw('existing@acme.test')).status === 200);
await T(olivia, 'sso-save', { issuer, clientId: 'cid', enabled: true, domains: 'acme.test', enforce: true });
const blocked = await pw('existing@acme.test');
check('with "require SSO" the password form refuses the company domain', blocked.status === 403 && /single sign-on/i.test(await blocked.text()));
await T(olivia, 'sso-save', { issuer, clientId: 'cid', enabled: false, domains: 'acme.test' });
check('turning SSO off lifts the requirement and stops SSO sign-in', (await pw('existing@acme.test')).status === 200 && /sso_error/.test((await signIn('existing@acme.test')).loc));
idp.close(); await pool.end(); done(); process.exit(0);
