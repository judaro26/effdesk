import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';
import { verifySnapshot, restoreSnapshot } from './restore-blobs.js';

export async function restoreAndVerifySnapshot(store, directory) {
  const { manifest, verified, totalBytes } = await verifySnapshot(directory);
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
    return { restored: restoredKeys.length, totalBytes };
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
  const result = await restoreAndVerifySnapshot(store, directory);
  console.log('Isolated Netlify Blobs restore/read-back passed: ' + result.restored +
    ' objects, ' + result.totalBytes + ' bytes. Test objects were removed afterward.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Isolated Netlify Blobs restore drill failed:', error.message);
    process.exitCode = 1;
  });
}
