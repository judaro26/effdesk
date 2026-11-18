import assert from 'node:assert/strict';
import { enableStagingLiveChatOverride } from './staging-seed-entitlement.js';

const calls = [];
const client = { query: async (sql, params) => { calls.push({ sql, params }); return { rowCount: 1 }; } };

await enableStagingLiveChatOverride(client, 'stg_effdesk_org_01');
assert.equal(calls.length, 1);
assert.deepEqual(calls[0].params, ['stg_effdesk_org_01', 3]);
assert.match(calls[0].sql, /insert into org_overrides/);
assert.match(calls[0].sql, /seat_limit/);
assert.match(calls[0].sql, /greatest\(coalesce\(org_overrides\.seat_limit, 0\), excluded\.seat_limit\)/);
assert.match(calls[0].sql, /array\['live_chat'\]::text\[\]/);
assert.match(calls[0].sql, /array_append\(org_overrides\.features_on, 'live_chat'\)/);
assert.match(calls[0].sql, /array_remove\(org_overrides\.features_off, 'live_chat'\)/);
assert.match(calls[0].sql, /updated_by = 'staging-seeder'/);

await enableStagingLiveChatOverride(client, 'stg_effdesk_org_02', 5);
assert.deepEqual(calls[1].params, ['stg_effdesk_org_02', 5]);

await assert.rejects(
  () => enableStagingLiveChatOverride(client, 'customer_workspace_123'),
  /non-synthetic workspace/
);
await assert.rejects(
  () => enableStagingLiveChatOverride(client, 'stg_effdesk_org_03', 1),
  /whole number from 2 to 20/
);
assert.equal(calls.length, 2, 'invalid inputs must not reach the database');

console.log('Staging Live Chat entitlement and seat-limit tests passed.');
