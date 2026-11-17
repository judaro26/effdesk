import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('./bench-chat-mixed.js',import.meta.url),'utf8');
assert.match(source,/const warmupTasks=buildTasks\(1\)/,'runs one unmeasured warm-up round');
assert.match(source,/executeTasks\(warmupTasks,settings\.concurrency,'warmup'\)/,'executes warm-up at profile concurrency');
assert.match(source,/connectWait\.splice\(0\)/,'excludes setup and warm-up connection waits');
assert.match(source,/connectionLease\.splice\(0\)/,'excludes setup and warm-up connection lease samples');
assert.match(source,/const leaseStarted=new WeakMap\(\)/,'tracks lease start per pooled client');
assert.match(source,/function finishLease\(client\)/,'records connection hold duration exactly once per lease');
assert.ok(source.includes("pool.on('acquire',client=>leaseStarted.set(client,performance.now()))"),'starts lease timing from the pool acquire lifecycle event');
assert.ok(source.includes("pool.on('release',(error,client)=>finishLease(client))"),'ends lease timing from the pool release lifecycle event');
assert.match(source,/connection_lease_ms:sortedStats\(connectionLease\)/,'reports connection lease percentiles separately from acquisition wait');
assert.match(source,/querySamples\.clear\(\)/,'limits SQL timing diagnostics to measured rounds');
assert.match(source,/const measuredResults=\[\]/,'retains raw measured samples');
assert.match(source,/measuredResults\.flatMap\(r=>r\.samples\[s\.name\]\)/,'computes aggregate percentiles from raw samples');
assert.match(source,/rounds:measuredRounds/,'reports independent per-round results');
assert.match(source,/max_waiting_sampled:maxSamples\.waiting/,'reports measured pool waiting pressure');
assert.match(source,/if\(warmupFailures\|\|totalFailures\)process\.exitCode=1/,'fails the benchmark when warm-up or measured requests fail');
// The merged #207 instrumentation must retain callback and promise connect() overloads.
assert.match(source,/pool\.connect=function\(\.\.\.args\)/,'does not force pool.connect into an async function');
assert.match(source,/if\(typeof args\[0\]==='function'\)/,'preserves the callback overload');
assert.match(source,/return connect\(\.\.\.args\)\.then\(client=>/,'preserves the promise overload');

assert.match(source,/import \{ getPool, withOrg \} from '\.\.\/src\/db\.js'/,'uses the same instrumented pool factory as the deployed application');
assert.match(source,/const pool=getPool\(rawUrl\)/,'uses the production pool configuration rather than a benchmark-only raw pool');
assert.match(source,/const telemetry=\/performance_\(\?:minute\|query_minute\|vitals_minute\)\/i\.test\(sql\)/,'separates telemetry SQL writes from application query fingerprints');
assert.match(source,/telemetryWrites\.push\(elapsed\)/,'measures the cost of performance telemetry writes');
assert.match(source,/performance_sql_telemetry:/,'reports the sampled telemetry-write rate and latency');
assert.match(source,/const callbackIndex=queryArgs\.findIndex/,'instruments callback and promise SQL query overloads');

console.log('✓ mixed chat benchmark reliability, app pool, and telemetry checks passed');
