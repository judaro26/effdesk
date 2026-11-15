import assert from 'node:assert/strict';
import { chatPerformanceFromRows } from '../src/reports.js';

const rows = [
  { created_at: '2026-11-15T10:00:00Z', first_response_at: '2026-11-15T10:02:00Z', solved_at: '2026-11-15T10:12:00Z' },
  { created_at: '2026-11-15T11:00:00Z', first_response_at: '2026-11-15T11:06:00Z', solved_at: null },
  { created_at: '2026-11-15T12:00:00Z', first_response_at: null, solved_at: null }
];
const result = chatPerformanceFromRows(rows, 4, 2, [{ name: 'Alex', n: 3 }]);
assert.equal(result.total, 3);
assert.equal(result.active, 4);
assert.equal(result.waiting, 2);
assert.equal(result.answered, 2);
assert.equal(result.resolved, 1);
assert.equal(result.firstReply.avgMin, 4);
assert.equal(result.firstReply.medianMin, 4);
assert.equal(result.resolution.avgMin, 12);
assert.deepEqual(result.activeByAgent, [{ name: 'Alex', n: 3 }]);
assert.equal(chatPerformanceFromRows([], 0, 0).firstReply.avgMin, null);
console.log('Live Chat performance metrics: ok');
