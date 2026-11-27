// Verify concurrent deploy/build processes cannot apply the same migration twice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import pg from 'pg';

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const expected = fs.readdirSync(migrationsDir).filter(name => name.endsWith('.sql')).sort();
const { url } = await freshDb('migration_lock');

// Start two independent migration clients at the same time, as overlapping deploys can.
const results = await Promise.all([migrate(url), migrate(url)]);
const applied = results.flat().sort();
assert.deepEqual(applied, expected, 'each migration must be applied exactly once across concurrent runners');
assert.equal(results.filter(result => result.length > 0).length, 1, 'one runner should perform the migrations while the other observes the completed schema');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const rows = await client.query('select name from schema_migrations order by name');
  assert.deepEqual(rows.rows.map(row => row.name), expected, 'migration ledger must contain every migration exactly once');
} finally {
  await client.end();
}
console.log(`concurrent migration lock test passed (${expected.length} migrations applied once)`);
