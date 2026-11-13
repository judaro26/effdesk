// src/integration-hub.js
// Tenant-owned credentials and health checks for provider adapters. Only providers with
// implemented adapters are connectable; the rest remain catalog-only until their adapters ship.
import { seal, unseal } from './sso.js';
import { withOrg } from './db.js';

const PROVIDERS = {
  github: { id: 'github', name: 'GitHub', category: 'Developer tools', endpoint: 'https://api.github.com/user' },
  gitlab: { id: 'gitlab', name: 'GitLab', category: 'Developer tools', endpoint: 'https://gitlab.com/api/v4/user' },
};
const clean = (v, n = 300) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const secret = env => String(env.BETTER_AUTH_SECRET || '');
const enc = (env, value) => seal(secret(env), value);
const dec = (env, value) => unseal(secret(env), value);

function scopesFrom(response, provider) {
  const raw = response.headers.get(provider === 'github' ? 'x-oauth-scopes' : 'x-oauth-scopes') || response.headers.get('scope') || '';
  return [...new Set(raw.split(/[ ,]+/).map(x => clean(x, 100)).filter(Boolean))].slice(0, 100);
}
async function verify(provider, token, fetchFn = fetch) {
  const p = PROVIDERS[provider];
  if (!p) return { ok: false, error: 'That provider is not available yet.' };
  let response;
  try {
    response = await fetchFn(p.endpoint, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: {
        accept: 'application/json',
        authorization: 'Bearer ' + token,
        'user-agent': 'EffDesk-Integration/1',
        ...(provider === 'github' ? { 'x-github-api-version': '2022-11-28' } : {}),
      },
    });
  } catch {
    return { ok: false, error: 'The provider could not be reached. Check the connection and try again.' };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, error: 'The provider rejected this token. Check that it is valid and has the required permissions.' };
  if (!response.ok) return { ok: false, error: 'The provider returned an error (' + response.status + '). Try again later.' };
  const profile = await response.json().catch(() => null);
  if (!profile || !(profile.id || profile.username || profile.login)) return { ok: false, error: 'The provider returned an unexpected account profile.' };
  return {
    ok: true,
    accountId: String(profile.id || ''),
    username: clean(profile.login || profile.username || profile.name || '', 160),
    name: clean(profile.name || profile.username || profile.login || '', 160),
    scopes: scopesFrom(response, provider),
  };
}

export async function listIntegrationConnections(pool, orgId) {
  return withOrg(pool, orgId, async c => ({
    ok: true,
    connections: (await c.query(
      'select provider,status,account_username,account_name,granted_scopes,last_success_at,last_attempt_at,last_error,created_at,updated_at from integration_connections where org_id=$1 order by provider',
      [orgId],
    )).rows,
    availableProviders: Object.values(PROVIDERS).map(({ id, name, category }) => ({ id, name, category, available: true, authType: 'personal_access_token' })),
  }));
}

export async function connectIntegration(pool, env, orgId, actorId, provider, input, { fetchFn = fetch } = {}) {
  if (!PROVIDERS[provider]) return { ok: false, status: 400, error: 'That provider is not available yet.' };
  const token = clean(input?.token, 1000);
  if (token.length < 12) return { ok: false, status: 400, error: 'Enter a valid personal access token.' };
  if (!secret(env)) return { ok: false, status: 500, error: 'Credential encryption is not configured on this server.' };
  const checked = await verify(provider, token, fetchFn);
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  await withOrg(pool, orgId, c => c.query(
    `insert into integration_connections
      (org_id,provider,status,credentials_enc,account_id,account_username,account_name,granted_scopes,last_success_at,last_attempt_at,last_error,created_by)
     values ($1,$2,'connected',$3,$4,$5,$6,$7,now(),now(),null,$8)
     on conflict (org_id,provider) do update set status='connected',credentials_enc=$3,account_id=$4,account_username=$5,account_name=$6,granted_scopes=$7,last_success_at=now(),last_attempt_at=now(),last_error=null,updated_at=now(),created_by=$8`,
    [orgId, provider, enc(env, token), checked.accountId, checked.username, checked.name, checked.scopes, actorId],
  ));
  return { ok: true, provider, accountUsername: checked.username, accountName: checked.name, scopes: checked.scopes };
}

export async function testIntegrationConnection(pool, env, orgId, provider, { fetchFn = fetch } = {}) {
  if (!PROVIDERS[provider]) return { ok: false, status: 400, error: 'That provider is not available yet.' };
  const row = (await withOrg(pool, orgId, c => c.query(
    'select credentials_enc from integration_connections where org_id=$1 and provider=$2', [orgId, provider],
  ))).rows[0];
  if (!row) return { ok: false, status: 404, error: 'Connect this provider first.' };
  let checked;
  try { checked = await verify(provider, dec(env, row.credentials_enc), fetchFn); }
  catch { checked = { ok: false, error: 'The saved credential could not be decrypted. Reconnect this provider.' }; }
  await withOrg(pool, orgId, c => c.query(
    'update integration_connections set status=$3,last_attempt_at=now(),last_success_at=case when $3=\'connected\' then now() else last_success_at end,last_error=$4,updated_at=now() where org_id=$1 and provider=$2',
    [orgId, provider, checked.ok ? 'connected' : 'degraded', checked.ok ? null : checked.error],
  ));
  return checked.ok ? { ok: true, provider, accountUsername: checked.username, accountName: checked.name, scopes: checked.scopes } : { ok: false, status: 502, error: checked.error };
}

export async function disconnectIntegration(pool, orgId, provider) {
  if (!PROVIDERS[provider]) return { ok: false, status: 400, error: 'That provider is not available yet.' };
  const r = await withOrg(pool, orgId, c => c.query('delete from integration_connections where org_id=$1 and provider=$2 returning provider', [orgId, provider]));
  return r.rowCount ? { ok: true } : { ok: false, status: 404, error: 'No connection was found for that provider.' };
}
