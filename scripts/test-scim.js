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
const post = await call('POST', '/Users', { schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'], userName: 'new-agent@example.test', displayName: 'New Agent', name: { givenName: 'New', familyName: 'Agent' }, active: true });
const resource = await post.json();
check('SCIM creates a user resource and tenant membership', post.status === 201 && resource.active === true && resource.userName === 'new-agent@example.test' && (await pool.query('select 1 from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1)', [org.id])).rowCount === 1);
const listed = await (await call('GET', '/Users')).json();
check('SCIM list returns tenant-scoped resources', listed.totalResults === 1 && listed.Resources[0].id === resource.id);
const patched = await call('PATCH', '/Users/' + resource.id, { schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations: [{ op: 'replace', path: 'active', value: false }] });
check('SCIM deactivation removes only the workspace membership', patched.status === 200 && (await patched.json()).active === false && (await pool.query('select 1 from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1)', [org.id])).rowCount === 0);
const reactivated = await call('PATCH', '/Users/' + resource.id, { Operations: [{ op: 'replace', path: 'active', value: true }] });
check('SCIM reactivation restores a standard member', reactivated.status === 200 && (await reactivated.json()).active === true && (await pool.query('select role from member where "organizationId"=$1 and "userId"=(select user_id from scim_users where org_id=$1)', [org.id])).rows[0]?.role === 'member');
const deleted = await call('DELETE', '/Users/' + resource.id);
check('SCIM DELETE is a deprovisioning operation, not a global user deletion', deleted.status === 204 && (await pool.query('select 1 from "user" where email=$1', ['new-agent@example.test'])).rowCount === 1);
const unauthorized = await call('GET', '/Users', undefined, 'not-a-real-token');
check('invalid bearer tokens are rejected', unauthorized.status === 401);
const revoked = await revokeScimToken(pool, org.id, created.token.id);
check('SCIM token revocation immediately blocks requests', revoked.ok && (await call('GET', '/Users')).status === 401);
await pool.end(); await done();
