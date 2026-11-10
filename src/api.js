// src/api.js: API TOKENS. A token looks like  effk.<organization id>.<secret>  and is shown once; only its SHA-256 is kept. The organization id inside the token only tells us where to look (row security
// then applies); the secret decides. A token acts as "API: <its name>" and can do what the REST API in docs/API.md offers.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
const sha = v => crypto.createHash('sha256').update(v).digest('hex');
export const MAX_TOKENS = 10;
export async function listTokens(pool, orgId) { return withOrg(pool, orgId, async c => ({ ok: true, tokens: (await c.query('select id, name, prefix, created_at, last_used_at from api_tokens where org_id = $1 order by id', [orgId])).rows })); }
export async function createToken(pool, orgId, actorId, name) {
  const nm = String(name || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60); if (!nm) return { ok: false, status: 400, error: 'Give the token a name, for example Zapier.' };
  return withOrg(pool, orgId, async c => {
    if ((await c.query('select count(*)::int n from api_tokens where org_id = $1', [orgId])).rows[0].n >= MAX_TOKENS) return { ok: false, status: 400, error: `You can have up to ${MAX_TOKENS} tokens.` };
    const secret = crypto.randomBytes(30).toString('base64url'), token = `effk.${orgId}.${secret}`;
    const id = (await c.query('insert into api_tokens (org_id, name, prefix, hash, created_by) values ($1,$2,$3,$4,$5) returning id', [orgId, nm, secret.slice(0, 6), sha(token), actorId])).rows[0].id;
    return { ok: true, id, token };                                             // shown once, here
  });
}
export const deleteToken = (pool, orgId, id) => withOrg(pool, orgId, async c => (await c.query('delete from api_tokens where org_id = $1 and id = $2', [orgId, Number(id) || 0])).rowCount > 0);
// "Bearer effk.…" -> { orgId, name } or null
export async function authenticate(pool, header) {
  const m = /^Bearer\s+(effk\.[A-Za-z0-9_-]{1,64}\.[A-Za-z0-9_-]{20,64})$/.exec(String(header || '')); if (!m) return null;
  const orgId = m[1].split('.')[1];
  return withOrg(pool, orgId, async c => {
    const r = (await c.query('update api_tokens set last_used_at = now() where org_id = $1 and hash = $2 returning name', [orgId, sha(m[1])])).rows[0];
    return r ? { orgId, name: r.name } : null;
  });
}
