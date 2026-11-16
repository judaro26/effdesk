import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('./bench-chat-mixed.js',import.meta.url),'utf8');
assert.match(source,/const warmupTasks=buildTasks\(1\)/,'runs one unmeasured warm-up round');
assert.match(source,/executeTasks\(warmupTasks,settings\.concurrency,'warmup'\)/,'executes warm-up at profile concurrency');
assert.match(source,/connectWait\.splice\(0\)/,'excludes setup and warm-up connection waits');
assert.match(source,/connectionLease\.splice\(0\)/,'excludes setup and warm-up connection lease samples');
assert.match(source,/const leaseStarted=new WeakMap\(\)/,'tracks lease start per pooled client');
assert.match(source,/function finishLease\(client\)/,'records connection hold duration exactly once per lease');
assert.match(source,/pool\\.on\\('acquire',client=>leaseStarted\\.set\\(client,performance\\.now\\(\\)\\)\\)/,'starts lease timing from the pool acquire lifecycle event');
assert.match(source,/pool\\.on\\('release',\\(error,client\\)=>finishLease\\(client\\)\\)/,'ends lease timing from the pool release lifecycle event');
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
console.log('✓ mixed chat benchmark reliability and connection-overload checks passed');
