import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('./bench-chat-mixed.js',import.meta.url),'utf8');
assert.match(source,/const warmupTasks=buildTasks\(1\)/,'runs one unmeasured warm-up round');
assert.match(source,/executeTasks\(warmupTasks,settings\.concurrency,'warmup'\)/,'executes warm-up at profile concurrency');
assert.match(source,/connectWait\.splice\(0\)/,'excludes setup and warm-up connection waits');
assert.match(source,/const measuredResults=\[\]/,'retains raw measured samples');
assert.match(source,/measuredResults\.flatMap\(r=>r\.samples\[s\.name\]\)/,'computes aggregate percentiles from raw samples');
assert.match(source,/rounds:measuredRounds/,'reports independent per-round results');
assert.match(source,/max_waiting_sampled:maxSamples\.waiting/,'reports measured pool waiting pressure');
assert.match(source,/if\(warmupFailures\|\|totalFailures\)process\.exitCode=1/,'fails the benchmark when warm-up or measured requests fail');
console.log('✓ mixed chat benchmark warm-up, repeated-round, and measurement-isolation checks passed');
