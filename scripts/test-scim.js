// scripts/test-scim.js: tenant-scoped SCIM 2.0 provisioning and deprovisioning.
import crypto from 'node:crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { grantLicense } from '../src/license.js';
import { scim, createScimToken, listScimTokens, revokeScimToken } from '../src/scim.js';

const SECRET = crypto.randomBytes(32).toString('base64');
const { url } = await freshDb('scim'); await migrate(url);
const pool = makePool(url), mailer = makeMailer({ transport: async () => {} });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signup = async (email, name) => {
  await auth.api.signUpEmail({ body: { email, password: 'correct horse battery', name } });
  const r = await auth.api.signInEmail({ body: { email, password: 'correct horse battery' }, returnHeaders: true });
  const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; ');
  return { headers: new Headers({ cookie }), user: r.response.user };
};
const owner = await signup('scim-owner@example.test', 'SCIM Owner');
const org = await auth.api.createOrganization({ body: { name: 'SCIM Workspace', slug: 'scim-workspace' }, headers: owner.headers });
await grantLicense(pool, { orgId: org.id, actorEmail: 'owner@effdesk.test', note: 'SCIM test' });
const created = await createScimToken(pool, org.id, owner.user.id, 'Test identity provider');
check('SCIM tokens are random and returned only at creation', created.ok && created.secret.startsWith('effscim_') && (await listScimTokens(pool, org.id)).tokens.length === 1);
const call = async (method, path, body, token = created.secret) => scim(new Request('https://app.effdesk.test/api/scim/v2' + path, {
  method, headers: { authorization: 'Bearer ' + token, 'content-type': 'application/scim+json' }, body: body === undefined ? undefined : JSON.stringify(body),
}), { pool });
const post = await call('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'new-agent@example.test', externalId: 'idp-1001', displayName: 'New Agent', name: { givenName: 'New', familyName: 'Agent' }, active: true });
const resource = await post.json();
check('SCIM creates a user resource and tenant membership', post.status === 201 && resource.active === true && resource.userName === 'new-agent@example.test' && (await pool.query('select 1 from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1)', [org.id])).rowCount === 1);
const listed = await (await call('GET', '/Users')).json();
check('SCIM list returns tenant-scoped resources', listed.totalResults === 1 && listed.Resources[0].id === resource.id);
const duplicateExternal = await call('POST', '/Users', { userName: 'duplicate-agent@example.test', externalId: 'idp-1001', displayName: 'Duplicate Agent', active: true });
check('A duplicate externalId is rejected before creating an account or membership', duplicateExternal.status === 409 && (await pool.query('select 1 from "user" where email=$1', ['duplicate-agent@example.test'])).rowCount === 0 && (await pool.query('select 1 from member where "organizationId"=$1 and "userId"=(select id from "user" where email=$2)', [org.id, 'duplicate-agent@example.test'])).rowCount === 0);
const second = await call('POST', '/Users', { userName: 'second-agent@example.test', externalId: 'idp-1002', displayName: 'Second Agent', active: true });
check('A distinct externalId provisions a second agent', second.status === 201);
const firstPage = await (await call('GET', '/Users?startIndex=1&count=1')).json();
const secondPage = await (await call('GET', '/Users?startIndex=2&count=1')).json();
check('SCIM pagination returns bounded pages with a stable total count', firstPage.totalResults === 2 && firstPage.itemsPerPage === 1 && secondPage.totalResults === 2 && secondPage.itemsPerPage === 1 && firstPage.Resources[0].id !== secondPage.Resources[0].id);
const conflictingDeactivate = await call('PATCH', '/Users/' + resource.id, { Operations: [{ op: 'replace', path: 'active', value: false }, { op: 'replace', path: 'externalId', value: 'idp-1002' }] });
check('A rejected identity update cannot deprovision the existing member', conflictingDeactivate.status === 409 && (await pool.query('select 1 from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1 and id=$2)', [org.id, resource.id])).rowCount === 1);
const patched = await call('PATCH', '/Users/' + resource.id, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] });
check('SCIM deactivation removes only the workspace membership', patched.status === 200 && (await patched.json()).active === false && (await pool.query('select 1 from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1 and id=$2)', [org.id, resource.id])).rowCount === 0);
const reactivated = await call('PATCH', '/Users/' + resource.id, { Operations: [{ op: 'replace', path: 'active', value: true }] });
check('SCIM reactivation restores a standard member', reactivated.status === 200 && (await reactivated.json()).active === true && (await pool.query('select role from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1 and id=$2)', [org.id, resource.id])).rows[0]?.role === 'member');
const deleted = await call('DELETE', '/Users/' + resource.id);
check('SCIM DELETE is a deprovisioning operation, not a global user deletion', deleted.status === 204 && (await pool.query('select 1 from "user" where email=$1', ['new-agent@example.test'])).rowCount === 1);
const oversizedScim = await scim(new Request('https://app.effdesk.test/api/scim/v2/Users', {
  method: 'POST',
  headers: { authorization: 'Bearer ' + created.secret, 'content-type': 'application/scim+json' },
  body: 'x'.repeat(100001),
}), { pool });
check('SCIM rejects oversized request bodies without Content-Length', oversizedScim.status === 400 && (await pool.query('select 1 from "user" where email=$1', ['oversized@example.test'])).rowCount === 0);
const unauthorized = await call('GET', '/Users', undefined, 'not-a-real-token');
check('invalid bearer tokens are rejected', unauthorized.status === 401);
const revoked = await revokeScimToken(pool, org.id, created.token.id);
check('SCIM token revocation immediately blocks requests', revoked.ok && (await call('GET', '/Users')).status === 401);
await pool.end(); await done();
