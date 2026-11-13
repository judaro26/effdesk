import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStore } from '@netlify/blobs';

export async function writeSnapshot(store, directory, createdAt = new Date().toISOString()) {
  const root = resolve(directory);
  await mkdir(resolve(root, 'objects'), { recursive: true });
  const entries = [];
  let totalBytes = 0;
  let index = 0;

  for await (const page of store.list({ paginate: true })) {
    for (const blob of page.blobs || []) {
      const key = String(blob.key || '');
      if (!key) throw new Error('Netlify Blobs returned an entry without a key.');
      const value = await store.get(key, { type: 'arrayBuffer' });
      if (value == null) throw new Error(`Blob disappeared during backup: ${key}`);
      const bytes = Buffer.from(value);
      const filename = String(++index).padStart(10, '0') + '.bin';
      await writeFile(resolve(root, 'objects', filename), bytes, { flag: 'wx' });
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      entries.push({ key, filename: 'objects/' + filename, size: bytes.length, sha256 });
      totalBytes += bytes.length;
    }
  }

  const manifest = {
    format: 'effdesk-netlify-blobs-backup-v1',
    store: 'attachments',
    createdAt,
    count: entries.length,
    totalBytes,
    entries
  };
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return { count: entries.length, totalBytes };
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node scripts/backup-blobs.js <output-directory>');
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_AUTH_TOKEN;
  if (!siteID || !token) throw new Error('NETLIFY_SITE_ID and NETLIFY_AUTH_TOKEN are required.');
  const store = getStore({ name: 'attachments', siteID, token, consistency: 'strong' });
  const result = await writeSnapshot(store, directory);
  console.log(`Netlify Blobs snapshot complete: ${result.count} objects, ${result.totalBytes} bytes.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Netlify Blobs backup failed:', error.message); process.exitCode = 1; });
}
