// src/sso.js: SINGLE SIGN-ON (OpenID Connect) FOR AN ORGANIZATION. An owner or admin enters the identity provider's address (issuer), client ID and secret (Okta, Microsoft Entra, Google Workspace, Auth0, Keycloak, anything that speaks OIDC) and the company's email domains. People then sign in through the provider.
//   start     /api/auth/sso/start?email=… (or ?org=slug): finds the organization by the email's domain and sends the person to the provider (with state, a nonce and PKCE)
//   callback  /api/auth/sso/callback: checks the answer (state, signature, issuer, audience, nonce, a verified email in the company's domains), creates the person if new, makes them a member and signs them in
// A person who already has an EffDesk account is only signed in by SSO if they already belong to that organization (or were created by it); otherwise the owner must invite them first, so a provider can never take over an account that is not its own.
// With "require SSO" on, the email and password form refuses the company's domains.
import { guardedFetch, publicAddress } from './guard.js';
import crypto from 'crypto';
import { createAuthEndpoint, createAuthMiddleware, APIError } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { checkSeat } from './billing.js';

const clean = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fail = (error, status = 400) => ({ ok: false, status, error });
const key = secret => crypto.createHash('sha256').update('sso-secret:' + secret).digest();
export const seal = (secret, text) => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(secret), iv), enc = Buffer.concat([c.update(text, 'utf8'), c.final()]); return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.'); };
export const unseal = (secret, sealed) => { const [iv, tag, enc] = String(sealed).split('.').map(x => Buffer.from(x, 'base64')), d = crypto.createDecipheriv('aes-256-gcm', key(secret), iv); d.setAuthTag(tag); return Buffer.concat([d.update(enc), d.final()]).toString('utf8'); };
const b64u = b => Buffer.from(b).toString('base64url');
const sign = (secret, text) => crypto.createHmac('sha256', secret).update('sso-state:' + text).digest('base64url');
// calls to a customer's identity provider never go to internal addresses and never follow redirects (on the real server; a local test provider is allowed elsewhere)
const outbound = (url, init) => process.env.NETLIFY ? guardedFetch(url, init) : fetch(url, { ...init, redirect: 'manual' });
const okUrl = u => { try { const x = new URL(u); return x.protocol === 'https:' || (x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname)); } catch { return false; } };
const domainOf = e => String(e || '').toLowerCase().split('@')[1] || '';
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const cols = 'org_id, enabled, issuer, client_id, client_secret_enc, domains, default_role, enforce';

// ---- settings (agents: owner/admin only, enforced by the handler) ----
export async function getSso(pool, orgId) {
  const r = (await pool.query(`select ${cols} from sso_providers where org_id = $1`, [orgId])).rows[0];
  return r ? { configured: true, enabled: r.enabled, issuer: r.issuer, clientId: r.client_id, hasSecret: true, domains: r.domains, defaultRole: r.default_role, enforce: r.enforce } : { configured: false, enabled: false, issuer: '', clientId: '', hasSecret: false, domains: [], defaultRole: 'member', enforce: false };
}
export async function saveSso(pool, env, orgId, input) {
  const issuer = clean(input.issuer, 300).replace(/\/+$/, ''), clientId = clean(input.clientId, 300), secret = clean(input.clientSecret, 500);
  const domains = [...new Set(String(Array.isArray(input.domains) ? input.domains.join(',') : input.domains || '').toLowerCase().split(/[\s,;]+/).map(d => d.replace(/^@/, '')).filter(Boolean))];
  if (!okUrl(issuer)) return fail('The issuer must be a web address starting with https://.');
  if (!clientId) return fail('Enter the client ID from your identity provider.');
  if (!domains.length || domains.length > 10 || !domains.every(d => DOMAIN.test(d))) return fail('Enter your company email domains, such as acme.com (up to 10).');
  const old = (await pool.query('select client_secret_enc from sso_providers where org_id = $1', [orgId])).rows[0];
  if (!secret && !old) return fail('Enter the client secret from your identity provider.');
  const clash = (await pool.query('select 1 from sso_providers where org_id <> $1 and domains && $2::text[]', [orgId, domains])).rowCount;
  if (clash) return fail('One of those domains is already used by another workspace.', 409);
  const enc = secret ? seal(env.BETTER_AUTH_SECRET, secret) : old.client_secret_enc, role = input.defaultRole === 'admin' ? 'admin' : 'member', enforce = input.enforce === true, enabled = input.enabled === true;
  if (enabled) { try { await discover(issuer); } catch (e) { return fail('We could not reach that identity provider (' + e.message + '). Check the issuer address.'); } }
  await pool.query('insert into sso_providers (org_id, enabled, issuer, client_id, client_secret_enc, domains, default_role, enforce) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (org_id) do update set enabled = $2, issuer = $3, client_id = $4, client_secret_enc = $5, domains = $6, default_role = $7, enforce = $8, updated_at = now()', [orgId, enabled, issuer, clientId, enc, domains, role, enforce && enabled]);
  return { ok: true, sso: await getSso(pool, orgId) };
}
export async function deleteSso(pool, orgId) { await pool.query('delete from sso_providers where org_id = $1', [orgId]); return { ok: true }; }

const docs = new Map();
export async function discover(issuer) {
  const hit = docs.get(issuer); if (hit && Date.now() - hit.at < 600000) return hit.doc;
  const r = await outbound(issuer + '/.well-known/openid-configuration', { signal: AbortSignal.timeout(8000) }); if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json(); if (!d.authorization_endpoint || !d.token_endpoint || !d.jwks_uri || !okUrl(d.authorization_endpoint) || !okUrl(d.token_endpoint) || !okUrl(d.jwks_uri)) throw new Error('not an OpenID Connect provider');
  if (process.env.NETLIFY) for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!(await publicAddress(new URL(d[k]).hostname))) throw new Error('the provider points at a private address');
  if (d.issuer && String(d.issuer).replace(/\/+$/, '') !== issuer) throw new Error('the provider names a different issuer');
  docs.set(issuer, { at: Date.now(), doc: d }); return d;
}
async function byOrgOrEmail(pool, q) {
  const email = clean(q.email, 254).toLowerCase(), slug = clean(q.org, 60).toLowerCase();
  const r = slug ? await pool.query('select p.*, o.slug, o.name from sso_providers p join "organization" o on o.id = p.org_id where o.slug = $1 and p.enabled', [slug]) : await pool.query('select p.*, o.slug, o.name from sso_providers p join "organization" o on o.id = p.org_id where p.enabled and $1 = any(p.domains)', [domainOf(email)]);
  return r.rows[0] || null;
}
export async function ssoForEmail(pool, email) { const r = (await pool.query('select enforce from sso_providers where enabled and $1 = any(domains)', [domainOf(email)])).rows[0]; return r ? { enforce: r.enforce } : null; }

// ---- the plugin ----
export function ssoPlugin({ pool, env = process.env, baseURL }) {
  const secret = () => String(env.BETTER_AUTH_SECRET || '');
  const back = (ctx, msg) => ctx.redirect(`${baseURL}/auth.html?sso_error=${encodeURIComponent(msg)}`);
  return {
    id: 'effdesk-sso',
    hooks: { before: [{
      matcher: c => c.path === '/sign-in/email',
      handler: createAuthMiddleware(async ctx => { const s = await ssoForEmail(pool, ctx.body && ctx.body.email); if (s && s.enforce) throw new APIError('FORBIDDEN', { message: 'Your company requires single sign-on. Use "Sign in with SSO".', code: 'SSO_REQUIRED' }); }),
    }] },
    endpoints: {
      ssoStart: createAuthEndpoint('/sso/start', { method: 'GET' }, async ctx => {
        const p = await byOrgOrEmail(pool, ctx.query || {}); if (!p) throw back(ctx, 'Single sign-on is not set up for that address.');
        let doc; try { doc = await discover(p.issuer); } catch { throw back(ctx, 'Your identity provider could not be reached.'); }
        const state = crypto.randomBytes(16).toString('base64url'), nonce = crypto.randomBytes(16).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url');
        const payload = b64u(JSON.stringify({ s: state, n: nonce, v: verifier, o: p.org_id, e: Date.now() + 600000 }));
        ctx.setCookie('effdesk_sso', payload + '.' + sign(secret(), payload), { path: '/api/auth/sso', httpOnly: true, sameSite: 'lax', secure: /^https:/.test(baseURL), maxAge: 600 });
        const u = new URL(doc.authorization_endpoint);
        Object.entries({ response_type: 'code', client_id: p.client_id, redirect_uri: baseURL + '/api/auth/sso/callback', scope: 'openid email profile', state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).forEach(([k, v]) => u.searchParams.set(k, v));
        const hint = clean(ctx.query && ctx.query.email, 254); if (hint) u.searchParams.set('login_hint', hint);
        throw ctx.redirect(u.toString());
      }),
      ssoCallback: createAuthEndpoint('/sso/callback', { method: 'GET' }, async ctx => {
        const q = ctx.query || {}, raw = ctx.getCookie ? ctx.getCookie('effdesk_sso') : null;
        const [payload, sig] = String(raw || '').split('.'); let st; try { if (!payload || !sig || !crypto.timingSafeEqual(Buffer.from(sign(secret(), payload)), Buffer.from(sig))) throw 0; st = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw back(ctx, 'The sign-in took too long or was not started here. Try again.'); }
        if (st.e < Date.now() || !q.state || q.state !== st.s) throw back(ctx, 'The sign-in took too long or was not started here. Try again.');
        if (q.error) throw back(ctx, 'Your identity provider said no: ' + clean(q.error_description || q.error, 150));
        const p = (await pool.query('select p.*, o.slug from sso_providers p join "organization" o on o.id = p.org_id where p.org_id = $1 and p.enabled', [st.o])).rows[0]; if (!p) throw back(ctx, 'Single sign-on is off for this workspace.');
        let claims;
        try {
          const doc = await discover(p.issuer);
          const tr = await outbound(doc.token_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ grant_type: 'authorization_code', code: String(q.code || ''), redirect_uri: baseURL + '/api/auth/sso/callback', client_id: p.client_id, client_secret: unseal(secret(), p.client_secret_enc), code_verifier: st.v }), signal: AbortSignal.timeout(10000) });
          const tj = await tr.json(); if (!tr.ok || !tj.id_token) throw new Error('no token');
          claims = (await jwtVerify(tj.id_token, createRemoteJWKSet(new URL(doc.jwks_uri)), { issuer: doc.issuer || p.issuer, audience: p.client_id })).payload;
          if (claims.nonce !== st.n) throw new Error('nonce');
        } catch { throw back(ctx, 'We could not confirm your sign-in with the identity provider.'); }
        const email = clean(claims.email || (/@/.test(claims.preferred_username || '') ? claims.preferred_username : ''), 254).toLowerCase();
        if (!email || claims.email_verified !== true || typeof claims.sub !== 'string' || !claims.sub.trim()) throw back(ctx, 'Your identity provider did not give a verified email address and subject.');
        if (!p.domains.includes(domainOf(email))) throw back(ctx, 'That email address is not in this workspace\'s company domains.');
        const ia = ctx.context.internalAdapter, found = await ia.findUserByEmail(email); let user = found && found.user;
        const providerId = 'sso:' + p.org_id;
        if (user) {
          const member = (await pool.query('select 1 from member where "organizationId" = $1 and "userId" = $2', [p.org_id, user.id])).rowCount, linked = (found.accounts || []).some(a => a.providerId === providerId);
          if (!member && !linked) throw back(ctx, 'You already have an EffDesk account. Ask an owner of the workspace to invite you first.');
        } else {
          const seat = await checkSeat(pool, p.org_id); if (!seat.ok) throw back(ctx, 'This workspace has no free seats. Ask an owner.');
          user = await ia.createUser({ email, name: clean(claims.name || email.split('@')[0], 100), emailVerified: true });
          await ia.linkAccount({ userId: user.id, providerId, accountId: String(claims.sub), accessToken: null });
        }
        if (!(await pool.query('select 1 from member where "organizationId" = $1 and "userId" = $2', [p.org_id, user.id])).rowCount) {
          const seat = await checkSeat(pool, p.org_id); if (!seat.ok) throw back(ctx, 'This workspace has no free seats. Ask an owner.');
          await pool.query('insert into member (id, "organizationId", "userId", role, "createdAt") values ($1,$2,$3,$4, now())', [crypto.randomUUID(), p.org_id, user.id, p.default_role]);
        }
        const session = await ia.createSession(user.id); if (!session) throw back(ctx, 'Sign-in failed. Try again.');
        await setSessionCookie(ctx, { session, user });
        ctx.setCookie('effdesk_sso', '', { path: '/api/auth/sso', maxAge: 0 });
        throw ctx.redirect(`${baseURL}/desk.html?org=${encodeURIComponent(p.org_id)}`);
      }),
    },
  };
}
