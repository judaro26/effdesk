import assert from 'node:assert/strict';
import { enableStagingLiveChatOverride } from './staging-seed-entitlement.js';

const calls = [];
const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };

await enableStagingLiveChatOverride(client, 'stg_effdesk_org_01');
assert.equal(calls.length, 1);
assert.deepEqual(calls[0].params, ['stg_effdesk_org_01']);
assert.match(calls[0].sql, /insert into org_overrides/);
assert.match(calls[0].sql, /array\['live_chat'\]::text\[\]/);
assert.match(calls[0].sql, /array_append\(org_overrides\.features_on, 'live_chat'\)/);
assert.match(calls[0].sql, /array_remove\(org_overrides\.features_off, 'live_chat'\)/);
assert.match(calls[0].sql, /updated_by = 'staging-seeder'/);

await assert.rejects(
  () => enableStagingLiveChatOverride(client, 'customer_workspace_123'),
  /non-synthetic workspace/
);
assert.equal(calls.length, 1, 'non-synthetic IDs must not reach the database');

console.log('Staging Live Chat entitlement tests passed.');
