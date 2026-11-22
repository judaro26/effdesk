import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';
import { verifySnapshot, restoreSnapshot } from './restore-blobs.js';
import crypto from 'node:crypto';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { attachmentDownload } from '../src/handlers.js';

export async function verifyRestoredAttachmentThroughApp(store, manifest) {
  const source = manifest.entries.find(entry => entry.size > 0);
  if (!source) throw new Error('No non-empty restored object is available for application-level verification.');
  const sourceValue = await store.get(source.key, { type: 'arrayBuffer' });
  if (sourceValue == null) throw new Error('Restored source object disappeared before application verification.');
  const bytes = Buffer.from(sourceValue);
  const { url } = await freshDb('restore_app');
  await migrate(url);
  const pool = makePool(url);
  const secret = crypto.randomBytes(32).toString('base64');
  const password = 'Restore drill only ' + crypto.randomBytes(18).toString('hex');
  const email = 'restore-' + crypto.randomUUID() + '@effdesk.test';
  const mailer = makeMailer({ transport: async () => {} });
  const auth = makeAuth({ pool, mailer, secret, baseURL: 'http://localhost:8888', requireVerified: false });
  const attachmentId = crypto.randomUUID();
  let canaryKey = '';
  try {
    await auth.api.signUpEmail({ body: { email, password, name: 'Restore Drill Agent' } });
    const signed = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
    const cookie = signed.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(value => value.split(';')[0]).join('; ');
    const agent = { cookie, headers: new Headers({ cookie }) };
    const org = await auth.api.createOrganization({
      body: { name: 'Restore Drill Workspace', slug: 'restore-drill-' + crypto.randomBytes(6).toString('hex') },
      headers: agent.headers
    });
    canaryKey = org.id + '/' + attachmentId;
    await store.set(canaryKey, bytes);
    await withOrg(pool, org.id, db => db.query(
      'insert into attachments (id,org_id,filename,content_type,size,uploaded_by) values ($1,$2,$3,$4,$5,$6)',
      [attachmentId, org.id, 'restored-attachment.bin', 'application/octet-stream', bytes.length, signed.response.user.id]
    ));
    const appStore = {
      async get(key) {
        const value = await store.get(key, { type: 'arrayBuffer' });
        return value == null ? null : Buffer.from(value);
      },
      set: (key, value) => store.set(key, value),
      delete: key => store.delete(key)
    };
    const deps = { pool, auth, store: appStore };
    const response = await attachmentDownload(new Request(
      'http://localhost/api/attachments/' + attachmentId + '?org=' + encodeURIComponent(org.id),
      { headers: { cookie } }
    ), deps);
    const downloaded = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, 'authenticated member must retrieve restored bytes through the attachment handler');
    assert.deepEqual(downloaded, bytes, 'application download must return the restored object bytes');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-disposition') || '', /attachment/);
    const anonymous = await attachmentDownload(new Request(
      'http://localhost/api/attachments/' + attachmentId + '?org=' + encodeURIComponent(org.id)
    ), deps);
    assert.equal(anonymous.status, 401, 'application download must still enforce sign-in');
    const wrongTenant = await attachmentDownload(new Request(
      'http://localhost/api/attachments/' + attachmentId + '?org=not-a-member'
    ), deps);
    assert.equal(wrongTenant.status, 403, 'application download must still enforce tenant membership');
    return { bytes: downloaded.length, sourceKey: source.key };
  } finally {
    if (canaryKey) await store.delete(canaryKey).catch(() => {});
    await pool.end();
  }
}

export async function restoreAndVerifySnapshot(store, directory, { verifyApplication } = {}) {
  const { manifest, verified, totalBytes } = await verifySnapshot(directory);
  if (verified < 1) throw new Error('Blob restore drill requires at least one object to prove live write/read-back.');
  // Require an empty destination so cleanup cannot erase pre-existing data.
  for (const entry of manifest.entries) {
    const existing = await store.get(entry.key, { type: 'arrayBuffer' });
    if (existing != null) {
      throw new Error('Disposable test store is not empty for snapshot key: ' + entry.key);
    }
  }
  const restoredKeys = [];
  try {
    const result = await restoreSnapshot(store, directory);
    assert.equal(result.restored, verified);
    for (const entry of manifest.entries) {
      const actual = await store.get(entry.key, { type: 'arrayBuffer' });
      if (actual == null) throw new Error('Restored object could not be read back: ' + entry.key);
      const bytes = Buffer.from(actual);
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (bytes.length !== entry.size || digest !== entry.sha256) {
        throw new Error('Restored object failed read-back verification: ' + entry.filename);
      }
      restoredKeys.push(entry.key);
    }
    const application = typeof verifyApplication === 'function'
      ? await verifyApplication({ manifest, verified, totalBytes })
      : null;
    return { restored: restoredKeys.length, totalBytes, application };
  } finally {
    // The destination must be a disposable, dedicated test site. Remove only keys
    // represented by this snapshot, including after a partial restore failure.
    const cleanupErrors = [];
    for (const key of [...new Set(manifest.entries.map(entry => entry.key))]) {
      try { await store.delete(key); }
      catch (error) { cleanupErrors.push(error); }
    }
    if (cleanupErrors.length) {
      throw new Error('Restore drill cleanup failed for ' + cleanupErrors.length +
        ' object(s); inspect the disposable test store before reusing it.');
    }
  }
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: BLOB_RESTORE_TEST_CONFIRM=RESTORE_TO_DISPOSABLE_SITE node scripts/test-netlify-blob-restore.js <snapshot-directory>');
  if (process.env.BLOB_RESTORE_TEST_CONFIRM !== 'RESTORE_TO_DISPOSABLE_SITE') {
    throw new Error('Refusing to write blobs without explicit disposable-site confirmation.');
  }
  const siteID = process.env.BLOB_RESTORE_TEST_SITE_ID;
  const token = process.env.BLOB_RESTORE_TEST_AUTH_TOKEN;
  if (!siteID || !token) throw new Error('BLOB_RESTORE_TEST_SITE_ID and BLOB_RESTORE_TEST_AUTH_TOKEN are required.');
  const store = getStore({ name: 'attachments', siteID, token, consistency: 'strong' });
  const result = await restoreAndVerifySnapshot(store, directory, {
    verifyApplication: ({ manifest }) => verifyRestoredAttachmentThroughApp(store, manifest)
  });
  console.log('Isolated Netlify Blobs restore/read-back passed: ' + result.restored +
    ' objects, ' + result.totalBytes + ' bytes.');
  console.log('EffDesk attachment handler verification passed: ' + result.application.bytes +
    ' bytes retrieved with authenticated tenant-scoped access. All test objects were removed afterward.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Isolated Netlify Blobs restore drill failed:', error.message);
    process.exitCode = 1;
  });
}
