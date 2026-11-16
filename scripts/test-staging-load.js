// Exercise the staging load-test guard without opening a database connection.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bench-staging.js');
const safeUrl = 'postgresql://load:secret@ep-staging-pooler.us-east-1.aws.neon.tech/staging_effdesk?sslmode=require';
const base = { ...process.env, STAGING_DATABASE_URL: safeUrl, STAGING_ORG_IDS: 'synthetic-org-a,synthetic-org-b', STAGING_BENCH_PROFILE: 'smoke' };
const run = env => spawnSync(process.execPath, [script, '--check'], { env: { ...base, ...env }, encoding: 'utf8' });
const accepted = run({});
assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
assert.match(accepted.stdout, /configuration is safe/);

for (const [name, env] of [
  ['production database name', { STAGING_DATABASE_URL: safeUrl.replace('/staging_effdesk', '/neondb') }],
  ['non-Neon host', { STAGING_DATABASE_URL: safeUrl.replace('ep-staging-pooler.us-east-1.aws.neon.tech', 'localhost') }],
  ['missing workspace IDs', { STAGING_ORG_IDS: '' }],
  ['one workspace only', { STAGING_ORG_IDS: 'synthetic-org-a' }],
  ['unsupported profile', { STAGING_BENCH_PROFILE: 'unbounded' }]
]) {
  const result = run(env);
  assert.notEqual(result.status, 0, `Expected guard to reject ${name}`);
  assert.match(result.stderr, /Refusing to run|must contain|must be/);
}
console.log('Staging load-test safety guard passed.');
