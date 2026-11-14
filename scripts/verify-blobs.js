import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySnapshot } from './restore-blobs.js';

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error('Usage: node scripts/verify-blobs.js <snapshot-directory>');
  const result = await verifySnapshot(directory);
  console.log('Netlify Blobs backup integrity passed: ' + result.verified +
    ' objects, ' + result.totalBytes + ' bytes.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Netlify Blobs backup verification failed:', error.message);
    process.exitCode = 1;
  });
}
