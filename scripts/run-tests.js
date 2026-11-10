// scripts/run-tests.js: runs every scripts/test-*.js, one after the other, and fails if any fails.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { spawnSync } from 'child_process';
const dir = path.dirname(fileURLToPath(import.meta.url)), bad = [];
for (const f of fs.readdirSync(dir).filter(f => /^test-.*\.js$/.test(f)).sort()) {
  const r = spawnSync('node', [path.join(dir, f)], { encoding: 'utf8' }); const out = (r.stdout || '') + (r.stderr || '');
  const last = out.trim().split('\n').pop(); console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${f}: ${last}`);
  if (r.status !== 0) { bad.push(f); console.log(out.split('\n').filter(l => /✗|Error|at /.test(l)).slice(0, 15).join('\n')); }
}
if (bad.length) { console.log(`\n${bad.length} test file(s) failed: ${bad.join(', ')}`); process.exit(1); }
console.log('\nAll test files passed.');
