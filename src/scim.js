// src/scim.js
// Tenant-scoped SCIM 2.0 user provisioning. SCIM credentials are looked up in a narrow
// global registry (only token digests are stored); all user mappings and memberships are
// changed inside withOrg so forced RLS remains the tenant boundary.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { checkSeat } from './billing.js';
import { rateLimit } from './guard.js';

const USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User';
const LIST_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
const ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';
const clean = (v, max = 250) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
const digest = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const fail = (detail, status = 400, scimType) => ({ ok: false, status, error: detail, ...(scimType ? { scimType } : {}) });
const validEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const response = (status, body, headers = {}) => new Response(body == null ? null : JSON.stringify(body), {
  status, headers: { 'content-type': 'application/scim+json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
});
const scimError = (status, detail, scimType) => response(status, { schemas: [ERROR_SCHEMA], status: String(status), detail, ...(scimType ? { scimType } : {}) });
const userResource = (row, base) => {
  const name = { ...(row.given_name ? { givenName: row.given_name } : {}), ...(row.family_name ? { familyName: row.family_name } : {}) };
  return {
    schemas: [USER_SCHEMA], id: row.scim_id, externalId: row.external_id || undefined,
    userName: row.email, name: Object.keys(name).length ? name : undefined,
    displayName: row.display_name || row.name || row.email, active: !!row.active,
    emails: [{ value: row.email, type: 'work', primary: true }],
    meta: { resourceType: 'User', created: new Date(row.created_at).toISOString(), lastModified: new Date(row.updated_at).toISOString(), location: base + '/' + encodeURIComponent(row.scim_id) },
  };
};
async function authenticate(pool, req) {
  const m = String(req.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m || m[1].length < 32) return null;
  const hash = digest(m[1]);
  const r = await pool.query("select org_id, id, last_used_at from scim_tokens where token_hash=$1 and revoked_at is null", [hash]);
  if (!r.rows[0]) return null;
  if (!r.rows[0].last_used_at || Date.now() - new Date(r.rows[0].last_used_at).getTime() > 60000) {
    await pool.query('update scim_tokens set last_used_at=now() where id=$1', [r.rows[0].id]);
  }
  return { orgId: r.rows[0].org_id, tokenId: r.rows[0].id };
}
export async function listScimTokens(pool, orgId) {
  return withOrg(pool, orgId, async c => ({
    ok: true, tokens: (await c.query('select id,name,created_at,last_used_at,revoked_at from scim_tokens where org_id=$1 and revoked_at is null order by created_at desc', [orgId])).rows,
  }));
}
export async function createScimToken(pool, orgId, actorId, name) {
  const label = clean(name, 80);
  if (!label) return fail('Give this SCIM token a name.');
  const token = 'effscim_' + crypto.randomBytes(32).toString('base64url');
  const id = crypto.randomUUID();
  const saved = await withOrg(pool, orgId, async c => {
    const count = await c.query('select count(*)::int as n from scim_tokens where org_id=$1 and revoked_at is null', [orgId]);
    if (count.rows[0].n >= 10) return false;
    await c.query('insert into scim_tokens (id,org_id,name,token_hash,created_by) values ($1,$2,$3,$4,$5)', [id, orgId, label, digest(token), actorId]);
    return true;
  });
  if (!saved) return fail('This workspace already has 10 active SCIM tokens. Revoke an unused token first.', 409);
  return { ok: true, token: { id, name: label }, secret: token };
}
export async function revokeScimToken(pool, orgId, id) {
  const r = await withOrg(pool, orgId, c => c.query(
    'update scim_tokens set revoked_at=coalesce(revoked_at,now()) where org_id=$1 and id=$2 and revoked_at is null returning id',
    [orgId, clean(id, 80)],
  ));
  return r.rowCount ? { ok: true } : fail('No active SCIM token was found.', 404);
}

const selectUsers = `select su.id as scim_id,su.external_id,su.active,su.display_name,su.given_name,su.family_name,
  su.created_at,su.updated_at,u.id as user_id,u.name,u.email
  from scim_users su join "user" u on u.id=su.user_id`;
async function readUser(pool, orgId, id) {
  return withOrg(pool, orgId, async c => (await c.query(selectUsers + ' where su.org_id=$1 and su.id=$2', [orgId, id])).rows[0] || null);
}
async function addMembership(pool, orgId, userId) {
  return withOrg(pool, orgId, async c => {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [orgId]);
    const existing = await c.query('select id from member where "organizationId"=$1 and "userId"=$2', [orgId, userId]);
    if (existing.rowCount) return { ok: true, added: false };
    const seat = await checkSeat(c, orgId);
    if (!seat.ok) return fail(seat.reason || 'The organization has no available seats.', 409);
    await c.query('insert into member (id,"organizationId","userId",role,"createdAt") values ($1,$2,$3,$4,now())', [crypto.randomUUID(), orgId, userId, 'member']);
    return { ok: true, added: true };
  });
}
async function deactivateMembership(pool, orgId, userId) {
  return withOrg(pool, orgId, async c => {
    const member = (await c.query('select role from member where "organizationId"=$1 and "userId"=$2', [orgId, userId])).rows[0];
    if (member?.role === 'owner') {
      const owners = Number((await c.query('select count(*)::int as n from member where "organizationId"=$1 and role=\'owner\'', [orgId])).rows[0]?.n || 0);
      if (owners <= 1) return fail('This is the workspace’s only owner. Assign another owner before deprovisioning this account.', 409);
    }
    await c.query('update tickets set assignee_id=null,updated_at=now() where org_id=$1 and assignee_id=$2', [orgId, userId]);
    await c.query('delete from ticket_followers where org_id=$1 and user_id=$2', [orgId, userId]);
    await c.query('delete from member_custom_role where org_id=$1 and user_id=$2', [orgId, userId]);
    await c.query('delete from agent_status where org_id=$1 and user_id=$2', [orgId, userId]);
    await c.query('delete from member where "organizationId"=$1 and "userId"=$2', [orgId, userId]);
    return { ok: true };
  });
}
function getEmail(input) {
  const candidates = [input?.userName, ...(Array.isArray(input?.emails) ? input.emails.filter(e => e && (e.primary || e.type === 'work')).map(e => e.value) : [])];
  return clean(candidates.find(Boolean), 254).toLowerCase();
}
function getNames(input) {
  const given = clean(input?.name?.givenName, 100), family = clean(input?.name?.familyName, 100);
  return { given, family, display: clean(input?.displayName || [given, family].filter(Boolean).join(' '), 180) };
}
async function upsertScimUser(pool, orgId, input, existing = null) {
  const email = getEmail(input);
  if (!validEmail(email)) return fail('A valid userName or work email is required.', 400, 'invalidValue');
  const names = getNames(input), externalId = clean(input.externalId, 250) || null;
  const active = input.active !== false;
  // Keep account creation, seat reservation, membership, SCIM mapping and audit
  // in one tenant-scoped transaction. A rejected provision must not leave a
  // globally verified account behind, and concurrent requests must not race seats.
  return withOrg(pool, orgId, async c => {
    let user = (await c.query('select id,name,email from "user" where lower(email)=lower($1) limit 1', [email])).rows[0];
    if (existing && existing.user_id !== user?.id) return fail('Changing a SCIM user email to an address belonging to another EffDesk account is not supported.', 409, 'uniqueness');
    if (externalId) {
      const clash = await c.query(
        'select id from scim_users where org_id=$1 and external_id=$2 and ($3::text is null or user_id<>$3) limit 1',
        [orgId, externalId, user?.id || existing?.user_id || null],
      );
      if (clash.rowCount) return fail('That externalId is already assigned to another SCIM user.', 409, 'uniqueness');
    }

    let member = null;
    if (active) {
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [orgId]);
      member = (await c.query('select role from member where "organizationId"=$1 and "userId"=$2', [orgId, user?.id || existing?.user_id || ''])).rows[0] || null;
      if (!member) {
        const seat = await checkSeat(c, orgId);
        if (!seat.ok) return fail(seat.reason || 'The organization has no available seats.', 409);
      }
    } else {
      member = user ? (await c.query('select role from member where "organizationId"=$1 and "userId"=$2', [orgId, user.id])).rows[0] || null : null;
      if (member?.role === 'owner') {
        const owners = Number((await c.query('select count(*)::int as n from member where "organizationId"=$1 and role=\'owner\'', [orgId])).rows[0]?.n || 0);
        if (owners <= 1) return fail('This is the workspace’s only owner. Assign another owner before deprovisioning this account.', 409);
      }
    }

    let createdUser = false;
    if (!user) {
      const id = crypto.randomUUID(), display = names.display || email;
      user = (await c.query(
        'insert into "user" (id,name,email,"emailVerified","createdAt","updatedAt") values ($1,$2,$3,true,now(),now()) on conflict (email) do update set email=excluded.email returning id,name,email',
        [id, display, email],
      )).rows[0];
      createdUser = true;
    }
    if (active && !member) {
      await c.query('insert into member (id,"organizationId","userId",role,"createdAt") values ($1,$2,$3,$4,now())', [crypto.randomUUID(), orgId, user.id, 'member']);
    } else if (!active && member) {
      await c.query('update tickets set assignee_id=null,updated_at=now() where org_id=$1 and assignee_id=$2', [orgId, user.id]);
      await c.query('delete from ticket_followers where org_id=$1 and user_id=$2', [orgId, user.id]);
      await c.query('delete from member_custom_role where org_id=$1 and user_id=$2', [orgId, user.id]);
      await c.query('delete from agent_status where org_id=$1 and user_id=$2', [orgId, user.id]);
      await c.query('delete from member where "organizationId"=$1 and "userId"=$2', [orgId, user.id]);
    }

    const scimId = existing?.scim_id || crypto.randomUUID();
    const q = await c.query(`insert into scim_users (id,org_id,user_id,external_id,active,display_name,given_name,family_name)
      values ($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict (org_id,user_id) do update set external_id=excluded.external_id,active=excluded.active,display_name=excluded.display_name,given_name=excluded.given_name,family_name=excluded.family_name,updated_at=now()
      returning id as scim_id,external_id,active,display_name,given_name,family_name,created_at,updated_at`,
      [scimId, orgId, user.id, externalId, active, names.display || (createdUser ? user.name : null), names.given || null, names.family || null]);
    await c.query('insert into audit_log (org_id,actor_id,action,target,meta) values ($1,null,$2,$3,$4)', [
      orgId, active ? (existing ? 'scim.user.updated' : 'scim.user.provisioned') : 'scim.user.deprovisioned',
      user.email, JSON.stringify({ scimId: q.rows[0].scim_id, externalId, active }),
    ]);
    return { ok: true, row: { ...q.rows[0], user_id: user.id, name: user.name, email: user.email } };
  });
}
async function patchUser(pool, orgId, row, body) {
  const ops = Array.isArray(body?.Operations) ? body.Operations : Array.isArray(body?.operations) ? body.operations : [];
  if (!ops.length) return fail('PATCH requires at least one operation.', 400, 'invalidSyntax');
  const input = { userName: row.email, active: row.active, externalId: row.external_id, displayName: row.display_name, name: { givenName: row.given_name, familyName: row.family_name } };
  for (const op of ops) {
    const action = clean(op?.op, 20).toLowerCase(), path = clean(op?.path, 160).toLowerCase();
    if (!['add','replace','remove'].includes(action)) return fail('Unsupported PATCH operation.', 400, 'invalidSyntax');
    if (!path) {
      const v = op.value || {};
      if (v.active !== undefined) input.active = v.active !== false;
      if (v.displayName !== undefined) input.displayName = v.displayName;
      if (v.name) input.name = v.name;
      if (v.userName !== undefined) input.userName = v.userName;
      if (v.externalId !== undefined) input.externalId = v.externalId;
      if (v.emails) { input.emails = v.emails; const primary = v.emails.find(e => e && (e.primary || e.type === 'work')) || v.emails[0]; if (primary?.value) input.userName = primary.value; }
      continue;
    }
    if (path === 'active') input.active = action === 'remove' ? false : op.value !== false;
    else if (path === 'displayname') input.displayName = action === 'remove' ? '' : op.value;
    else if (path === 'username') input.userName = op.value;
    else if (path === 'externalid') input.externalId = action === 'remove' ? '' : op.value;
    else if (/^emails(?:\[[^\]]+\])?\.value$/.test(path)) { input.userName = action === 'remove' ? '' : op.value; input.emails = action === 'remove' ? [] : [{ value: op.value, type: 'work', primary: true }]; }
    else if (path === 'name.givenname') input.name.givenName = action === 'remove' ? '' : op.value;
    else if (path === 'name.familyname') input.name.familyName = action === 'remove' ? '' : op.value;
    else return fail('Unsupported PATCH path: ' + path, 400, 'noTarget');
  }
  return upsertScimUser(pool, orgId, input, row);
}
async function readScimJson(req) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > 100000) return null;
  if (!req.body) return null;
  const reader = req.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 100000) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(Buffer.from(value));
    }
    const raw = Buffer.concat(chunks, size).toString('utf8');
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : null;
  } catch { return null; }
}
export async function scim(req, { pool }) {
  const identity = await authenticate(pool, req);
  if (!identity) return scimError(401, 'A valid SCIM bearer token is required.');
  const { orgId, tokenId } = identity;
  if (await rateLimit(pool, 'scim:' + tokenId, 300, 60)) return scimError(429, 'Too many SCIM requests. Try again shortly.');
  const url = new URL(req.url), base = url.origin + url.pathname.replace(/\/Users(?:\/[^/]+)?\/?$/i, '/Users').replace(/\/+$/, '');
  if (req.method === 'GET' && /\/ServiceProviderConfig\/?$/i.test(url.pathname)) return response(200, {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    patch: { supported: true }, bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 }, changePassword: { supported: false },
    sort: { supported: false }, etag: { supported: false },
    authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Tenant-specific EffDesk SCIM bearer token', primary: true }],
  });
  if (req.method === 'GET' && /\/ResourceTypes\/?$/i.test(url.pathname)) return response(200, {
    schemas: [LIST_SCHEMA], totalResults: 1, startIndex: 1, itemsPerPage: 1,
    Resources: [{ schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: USER_SCHEMA }],
  });
  if (req.method === 'GET' && /\/Schemas\/?$/i.test(url.pathname)) return response(200, {
    schemas: [LIST_SCHEMA], totalResults: 1, startIndex: 1, itemsPerPage: 1,
    Resources: [{ schemas: ['urn:ietf:params:scim:schemas:core:2.0:Schema'], id: USER_SCHEMA, name: 'User', description: 'EffDesk user resource', attributes: [
      { name: 'userName', type: 'string', multiValued: false, required: true, caseExact: false, mutability: 'readWrite', returned: 'always', uniqueness: 'server' },
      { name: 'name', type: 'complex', multiValued: false, required: false, subAttributes: [{ name: 'givenName', type: 'string' }, { name: 'familyName', type: 'string' }] },
      { name: 'displayName', type: 'string', multiValued: false, required: false },
      { name: 'active', type: 'boolean', multiValued: false, required: false },
      { name: 'externalId', type: 'string', multiValued: false, required: false },
      { name: 'emails', type: 'complex', multiValued: true, required: false, subAttributes: [{ name: 'value', type: 'string' }, { name: 'type', type: 'string' }, { name: 'primary', type: 'boolean' }] },
    ] }],
  });
  const usersPath = url.pathname.match(/\/Users(?:\/([^/]+))?\/?$/i);
  if (!usersPath) return scimError(404, 'SCIM resource not found.');
  const id = usersPath[1] ? decodeURIComponent(usersPath[1]) : '';
  if (req.method === 'GET' && !id) {
    const rawStart = Number.parseInt(url.searchParams.get('startIndex') || '1', 10);
    const rawCount = Number.parseInt(url.searchParams.get('count') || '100', 10);
    const start = Number.isSafeInteger(rawStart) ? Math.min(1000000000, Math.max(1, rawStart)) : 1;
    const count = Number.isSafeInteger(rawCount) ? Math.min(200, Math.max(1, rawCount)) : 100;
    const filter = clean(url.searchParams.get('filter'), 500).match(/^(?:userName|externalId)\s+eq\s+"([^"]+)"$/i);
    const params = [orgId]; let where = ' where su.org_id=$1';
    if (filter) { params.push(filter[1]); where += filter[0].toLowerCase().startsWith('username') ? ' and lower(u.email)=lower($2)' : ' and su.external_id=$2'; }
    const page = await withOrg(pool, orgId, async c => {
      const total = Number((await c.query('select count(*)::int as n from scim_users su join "user" u on u.id=su.user_id' + where, params)).rows[0]?.n || 0);
      // count and start are parsed, clamped safe integers, so embedding these
      // numeric pagination values avoids shifting filter placeholders.
      const rows = (await c.query(selectUsers + where + ` order by su.created_at desc, su.id asc limit ${count} offset ${start - 1}`, params)).rows;
      return { total, rows };
    });
    const resources = page.rows.map(r => userResource(r, base));
    return response(200, { schemas: [LIST_SCHEMA], totalResults: page.total, startIndex: start, itemsPerPage: resources.length, Resources: resources });
  }
  if (req.method === 'GET' && id) {
    const row = await readUser(pool, orgId, id); return row ? response(200, userResource(row, base)) : scimError(404, 'User not found.');
  }
  if (req.method === 'POST' && !id) {
    const input = await readScimJson(req); if (!input) return scimError(400, 'A SCIM user resource is required.', 'invalidSyntax');
    const r = await upsertScimUser(pool, orgId, input);
    if (!r.ok) return scimError(r.status || 400, r.error, r.scimType);
    const resource = userResource(r.row, base);
    return response(201, resource, { location: resource.meta.location });
  }
  if ((req.method === 'PUT' || req.method === 'PATCH') && id) {
    const row = await readUser(pool, orgId, id); if (!row) return scimError(404, 'User not found.');
    const input = await readScimJson(req); if (!input) return scimError(400, 'A SCIM user resource is required or the request body is too large.', 'invalidSyntax');
    const r = req.method === 'PATCH' ? await patchUser(pool, orgId, row, input) : await upsertScimUser(pool, orgId, input, row);
    if (!r.ok) return scimError(r.status || 400, r.error, r.scimType);
    return response(200, userResource(r.row, base));
  }
  if (req.method === 'DELETE' && id) {
    const row = await readUser(pool, orgId, id); if (!row) return scimError(404, 'User not found.');
    const removed = await deactivateMembership(pool, orgId, row.user_id);
    if (!removed.ok) return scimError(removed.status || 409, removed.error);
    await withOrg(pool, orgId, async c => {
      await c.query('update scim_users set active=false,updated_at=now() where org_id=$1 and id=$2', [orgId, id]);
      await c.query('insert into audit_log (org_id,actor_id,action,target,meta) values ($1,null,$2,$3,$4)', [orgId, 'scim.user.deprovisioned', row.email, JSON.stringify({ scimId: id, externalId: row.external_id, active: false })]);
    });
    return response(204, null);
  }
  return scimError(405, 'Method not allowed.');
}
