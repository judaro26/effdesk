// scripts/lib/check.js: the smallest possible test harness (green tick, red cross, a summary and an exit code).
let passed = 0, failed = 0, finished = false;
process.on('exit', code => { if (!finished && code === 0) { console.log('\x1b[31m✗ the test run did not finish\x1b[0m'); process.exitCode = 1; } });
export const check = (name, ok, detail) => { if (ok) { passed++; console.log(`\x1b[32m✓\x1b[0m ${name}`); } else { failed++; console.log(`\x1b[31m✗ ${name}\x1b[0m${detail ? '\n  ' + String(detail).split('\n').join('\n  ') : ''}`); } };
export const done = () => { finished = true; console.log(`\n${passed} passed, ${failed} failed`); process.exit(failed ? 1 : 0); };
