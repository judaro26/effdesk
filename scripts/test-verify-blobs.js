import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { verifySnapshot } from './restore-blobs.js';

const root = await mkdtemp(resolve(tmpdir(), 'effdesk-blob-verify-'));
try {
  const objects = resolve(root, 'objects');
  await mkdir(objects);
  const payload = Buffer.from('restore verification fixture');
  const filename = 'objects/0000000001.bin';
  await writeFile(resolve(root, filename), payload);
  const manifest = {
    format: 'effdesk-netlify-blobs-backup-v1',
    store: 'attachments',
    createdAt: new Date().toISOString(),
    count: 1,
    totalBytes: payload.length,
    entries: [{
      key: 'test/fixture',
      filename,
      size: payload.length,
      sha256: createHash('sha256').update(payload).digest('hex')
    }]
  };
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(manifest));
  const result = await verifySnapshot(root);
  assert.equal(result.verified, 1);
  assert.equal(result.totalBytes, payload.length);

  await writeFile(resolve(root, filename), Buffer.from('tampered'));
  await assert.rejects(() => verifySnapshot(root), /integrity check failed/);
  console.log('Blob snapshot verification tests passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
