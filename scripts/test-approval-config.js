// Unit coverage for approval form configuration normalization.
import assert from 'node:assert/strict';
import { normalizeApprovalConfig } from '../src/approvals.js';

const disabled = normalizeApprovalConfig(null);
assert.deepEqual(disabled, { enabled: false, mode: 'all', approverIds: [], tasks: [] });

const config = normalizeApprovalConfig({
  enabled: true,
  mode: 'any',
  approverIds: [' agent-1 ', 'agent-1', '', 'agent-2'],
  tasks: [
    { title: '  Provision laptop  ', description: ' Prepare and encrypt device ', assigneeId: ' agent-2 ' },
    { title: '', description: 'Ignored because title is empty' },
    { title: 'Create account', assigneeId: '' }
  ]
});
assert.equal(config.enabled, true);
assert.equal(config.mode, 'any');
assert.deepEqual(config.approverIds, ['agent-1', 'agent-2']);
assert.deepEqual(config.tasks, [
  { title: 'Provision laptop', description: 'Prepare and encrypt device', assigneeId: 'agent-2', position: 0 },
  { title: 'Create account', description: '', assigneeId: '', position: 2 }
]);

const bounded = normalizeApprovalConfig({
  enabled: true,
  mode: 'unexpected',
  approverIds: Array.from({ length: 40 }, (_, i) => 'agent-' + i),
  tasks: Array.from({ length: 25 }, (_, i) => ({ title: 'Task ' + i }))
});
assert.equal(bounded.mode, 'all');
assert.equal(bounded.approverIds.length, 30);
assert.equal(bounded.tasks.length, 20);
console.log('Approval configuration tests passed.');
