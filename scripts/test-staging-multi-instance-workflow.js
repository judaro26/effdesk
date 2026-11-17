import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflow=fs.readFileSync(new URL('../.github/workflows/staging-multi-instance-chat.yml',import.meta.url),'utf8');
assert.match(workflow,/workflow_dispatch:/,'requires a manual workflow dispatch');
assert.match(workflow,/confirm_staging:[\s\S]*type: boolean/,'requires explicit staging confirmation');
assert.match(workflow,/if: \$\{\{ inputs\.confirm_staging == true \}\}/,'skips unless staging is explicitly confirmed');
assert.match(workflow,/matrix:[\s\S]*instance: \[1, 2, 3\]/,'runs three independent matrix instances');
assert.match(workflow,/max-parallel: 3/,'allows all three independent runners to overlap');
assert.match(workflow,/STAGING_DATABASE_URL: \$\{\{ secrets\.STAGING_DATABASE_URL \}\}/,'uses the protected staging secret');
assert.match(workflow,/STAGING_ORG_IDS: \$\{\{ vars\.STAGING_ORG_IDS \}\}/,'uses synthetic staging tenants');
assert.match(workflow,/STAGING_BENCH_PROFILE: smoke/,'starts with a conservative smoke profile per instance');
assert.match(workflow,/node scripts\/bench-chat-mixed\.js --check/,'validates the staging target before connecting');
assert.match(workflow,/node scripts\/bench-chat-mixed\.js 2>&1 \| tee/,'runs the real app-pool benchmark and retains its output');
assert.match(workflow,/actions\/upload-artifact@v4/,'preserves each instance log separately');
assert.match(workflow,/retention-days: 14/,'keeps benchmark evidence temporarily');
assert.match(workflow,/group: effdesk-staging-multi-instance-chat/,'serializes competing runs of this workflow');
console.log('✓ multi-instance staging workflow safety and isolation checks passed');
