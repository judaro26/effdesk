import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { writeSnapshot } from './backup-blobs.js';
import { restoreSnapshot } from './restore-blobs.js';

const source = new Map([['org-a/file-1', Buffer.from('ticket attachment')], ['org-b/help/image-1', Buffer.from([0, 1, 2, 255])]]);
const fakeStore = map => ({
  async *list() { yield { blobs: [...map.keys()].map(key => ({ key })) }; },
  async get(key) { return map.has(key) ? Buffer.from(map.get(key)) : null; },
  async set(key, bytes) { map.set(key, Buffer.from(bytes)); }
});
const directory = await mkdtemp(resolve(tmpdir(), 'effdesk-blobs-backup-'));
try {
  const result = await writeSnapshot(fakeStore(source), directory, '2026-11-13T00:00:00.000Z');
  assert.equal(result.count, 2);
  assert.equal(result.totalBytes, 21);
  const restored = new Map();
  const outcome = await restoreSnapshot(fakeStore(restored), directory);
  assert.equal(outcome.restored, 2);
  assert.deepEqual([...restored.keys()].sort(), [...source.keys()].sort());
  for (const [key, bytes] of source) assert.deepEqual(restored.get(key), bytes);

  const manifest = JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8'));
  await writeFile(resolve(directory, manifest.entries[0].filename), 'tampered');
  await assert.rejects(() => restoreSnapshot(fakeStore(new Map()), directory), /integrity check failed/);
  console.log('EffDesk blob backup tests passed.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
