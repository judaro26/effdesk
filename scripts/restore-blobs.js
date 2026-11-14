import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';

export async function verifySnapshot(directory) {
  const root = resolve(directory);
  const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'effdesk-netlify-blobs-backup-v1' || !Array.isArray(manifest.entries)) {
    throw new Error('Unrecognized Netlify Blobs backup manifest.');
  }
  if (!Number.isSafeInteger(manifest.count) || manifest.count !== manifest.entries.length ||
      !Number.isSafeInteger(manifest.totalBytes) || manifest.totalBytes < 0) {
    throw new Error('Backup manifest totals are invalid.');
  }

  const keys = new Set();
  let verifiedBytes = 0;
  for (const entry of manifest.entries) {
    if (typeof entry.key !== 'string' || !entry.key || keys.has(entry.key) ||
        typeof entry.filename !== 'string' || !/^objects\/\d{10}\.bin$/.test(entry.filename) ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 ||
        typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error('Backup manifest contains an invalid or duplicate object entry.');
    }
    keys.add(entry.key);
    const bytes = await readFile(resolve(root, entry.filename));
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== entry.size || digest !== entry.sha256) {
      throw new Error('Backup integrity check failed for ' + entry.filename + '.');
    }
    verifiedBytes += bytes.length;
  }
  if (verifiedBytes !== manifest.totalBytes) {
    throw new Error('Backup manifest total byte count does not match its objects.');
  }
  return { manifest, verified: manifest.entries.length, totalBytes: verifiedBytes };
}

export async function restoreSnapshot(store, directory) {
  const { manifest, verified, totalBytes } = await verifySnapshot(directory);
  // Validate every object before writing any of them to the destination store.
  for (const entry of manifest.entries) {
    const bytes = await readFile(resolve(directory, entry.filename));
    await store.set(entry.key, bytes);
  }
  return { restored: verified, expected: manifest.count, totalBytes };
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: BACKUP_RESTORE_CONFIRM=RESTORE_BLOBS node scripts/restore-blobs.js <snapshot-directory>');
  if (process.env.BACKUP_RESTORE_CONFIRM !== 'RESTORE_BLOBS') {
    throw new Error('Refusing to write blobs. Set BACKUP_RESTORE_CONFIRM=RESTORE_BLOBS after verifying the target site.');
  }
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error('NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are required.');
  const store = getStore({ name: 'attachments', siteID, token, consistency: 'strong' });
  const result = await restoreSnapshot(store, directory);
  console.log('Netlify Blobs restore complete: ' + result.restored + ' objects, ' + result.totalBytes + ' bytes.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Netlify Blobs restore failed:', error.message); process.exitCode = 1; });
}
