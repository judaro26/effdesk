import fs from 'node:fs';
import assert from 'node:assert/strict';

const runner = fs.readFileSync(new URL('./bench-chat-multi-instance.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('./bench-chat-mixed.js', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/staging-load-test.yml', import.meta.url), 'utf8');

assert.match(runner, /spawn\(process\.execPath, \['scripts\/bench-chat-mixed\.js'\]/, 'starts independent Node processes');
assert.match(runner, /STAGING_BENCH_INSTANCES/, 'supports a bounded instance count');
assert.match(runner, /instances < 2 \|\| instances > 3/, 'limits the staging run to two or three instances');
assert.match(runner, /perInstanceConcurrency = Math\.max\(1, Math\.ceil\(profiles\[profile\] \/ instances\)\)/, 'distributes the selected total concurrency across instances');
assert.match(runner, /stdio: \['ignore', 'pipe', 'pipe', 'ipc'\]/, 'uses IPC to coordinate worker processes');
assert.match(runner, /workers\.every\(item => item\.ready\)/, 'waits until all workers complete warm-up');
assert.match(runner, /worker\.child\.send\(\{ type: 'start-measured' \}\)/, 'releases the measured phase across workers together');
assert.match(runner, /aggregate_requests_per_second/, 'reports aggregate throughput across independent pools');
assert.match(runner, /configured_max_connections: totalPoolMax/, 'reports combined configured pool capacity');
assert.match(runner, /if \(failures\) process\.exitCode = 1/, 'fails if any instance reports request failures');
assert.match(runner, /host\.endsWith\('\.neon\.tech'\)/, 'requires Neon staging database host');
assert.match(runner, /database name must contain staging, stage, or test/, 'requires a staging/test database name');

assert.match(worker, /const pool=getPool\(rawUrl\)/, 'each worker uses the application pool factory');
assert.match(worker, /STAGING_BENCH_COORDINATED==='1'/, 'supports coordinated worker mode');
assert.match(worker, /process\.send\(\{type:'warmup-complete'\}\)/, 'announces warm-up completion to the parent');
assert.match(worker, /process\.once\('message'/, 'waits for the parent release before measured rounds');
assert.match(worker, /STAGING_BENCH_CONCURRENCY/, 'supports per-process concurrency allocation');

assert.match(workflow, /multi-instance-chat/, 'exposes multi-instance chat workload in manual workflow');
assert.match(workflow, /node scripts\/bench-chat-multi-instance\.js --check/, 'validates the multi-instance target before running');
// Permit the normal final newline in YAML files; the command must still be the last workflow step.
assert.match(workflow, /node scripts\/bench-chat-multi-instance\.js\s*$/, 'runs the multi-instance orchestrator');

console.log('✓ multi-instance chat benchmark safety, process isolation, and coordination checks passed');
