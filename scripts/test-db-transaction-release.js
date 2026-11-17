import assert from 'node:assert/strict';
import { withOrg } from '../src/db.js';

function fixture({ queryErrorAt = null, rollbackError = null } = {}) {
  const calls = [];
  let releaseError;
  const client = {
    escapeLiteral(value) { return "'" + String(value).replaceAll("'", "''") + "'"; },
    async query(sql) {
      calls.push(sql);
      if (sql === queryErrorAt || (sql === 'rollback' && rollbackError)) {
        throw sql === 'rollback' ? rollbackError : new Error('query failed: ' + sql);
      }
      return { rows: [] };
    },
    release(error) { releaseError = error; calls.push('release'); }
  };
  return {
    calls,
    client,
    get releaseError() { return releaseError; },
    pool: { async connect() { calls.push('connect'); return client; } }
  };
}

{
  const f = fixture();
  const result = await withOrg(f.pool, "tenant'one", async client => {
    assert.equal(client, f.client);
    f.calls.push('work');
    return 42;
  });
  assert.equal(result, 42);
  assert.deepEqual(f.calls, [
    'connect',
    "begin; select set_config('app.org_id', 'tenant''one', true)",
    'work',
    'commit',
    'release'
  ]);
  assert.equal(f.releaseError, undefined);
}

{
  const f = fixture();
  const original = new Error('business operation failed');
  await assert.rejects(withOrg(f.pool, 'tenant-a', async () => { throw original; }), error => error === original);
  assert.deepEqual(f.calls.slice(-2), ['rollback', 'release']);
  assert.equal(f.releaseError, undefined, 'a successfully rolled-back client can be reused');
}

{
  const rollbackFailure = new Error('rollback failed');
  const f = fixture({ rollbackError: rollbackFailure });
  const original = new Error('operation failed');
  await assert.rejects(withOrg(f.pool, 'tenant-a', async () => { throw original; }), error => error === original);
  assert.equal(f.releaseError, rollbackFailure, 'rollback failure must destroy the client');
}

{
  const f = fixture({ queryErrorAt: 'commit' });
  await assert.rejects(withOrg(f.pool, 'tenant-a', async () => 'ok'), /query failed: commit/);
  assert.equal(f.releaseError?.message, 'query failed: commit', 'ambiguous commit must destroy the client');
  assert.ok(!f.calls.includes('rollback'), 'discard an ambiguously committed client without reusing it');
}

{
  const f = fixture({ queryErrorAt: "begin; select set_config('app.org_id', 'tenant-a', true)" });
  await assert.rejects(withOrg(f.pool, 'tenant-a', async () => 'unreachable'), /query failed/);
  assert.equal(f.releaseError?.message, 'query failed: begin; select set_config', 'failed transaction setup must destroy the client');
}

console.log('Tenant transaction connection-release tests passed.');
