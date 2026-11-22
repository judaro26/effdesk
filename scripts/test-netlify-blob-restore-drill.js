import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { restoreAndVerifySnapshot } from './test-netlify-blob-restore.js';

const root = await mkdtemp(resolve(tmpdir(), 'effdesk-blob-restore-drill-'));
try {
  const payloads = [
    ['objects/0000000001.bin', 'fixture attachment one'],
    ['objects/0000000002.bin', 'fixture attachment two']
  ];
  await mkdir(resolve(root, 'objects'));
  const entries = [];
  for (let i = 0; i < payloads.length; i++) {
    const [filename, value] = payloads[i];
    const bytes = Buffer.from(value);
    await writeFile(resolve(root, filename), bytes);
    entries.push({
      key: 'restore-drill/fixture-' + (i + 1),
      filename,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex')
    });
  }
  const manifest = {
    format: 'effdesk-netlify-blobs-backup-v1',
    store: 'attachments',
    createdAt: new Date().toISOString(),
    count: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.size, 0),
    entries
  };
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));

  const values = new Map();
  const store = {
    async get(key) { return values.has(key) ? values.get(key) : null; },
    async set(key, bytes) { values.set(key, Buffer.from(bytes)); },
    async delete(key) { values.delete(key); }
  };
  const result = await restoreAndVerifySnapshot(store, root);
  assert.equal(result.restored, 2);
  assert.equal(result.totalBytes, manifest.totalBytes);
  assert.equal(values.size, 0, 'successful drill must clean up test objects');

  const corruptingStore = {
    async get(key) { return values.has(key) ? values.get(key) : null; },
    async set(key, bytes) { values.set(key, Buffer.from(bytes).map((byte, index) => index === 0 ? byte ^ 1 : byte)); },
    async delete(key) { values.delete(key); }
  };
  await assert.rejects(() => restoreAndVerifySnapshot(corruptingStore, root), /read-back verification/);
  assert.equal(values.size, 0, 'failed read-back must clean up partial test objects');

  values.set(entries[0].key, Buffer.from('pre-existing'));
  await assert.rejects(() => restoreAndVerifySnapshot(store, root), /not empty/);
  assert.equal(values.get(entries[0].key).toString(), 'pre-existing',
    'preflight must preserve pre-existing objects');
  console.log('Isolated Netlify Blobs restore drill tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
