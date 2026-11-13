// Unit coverage for approval form configuration and stage outcome rules.
import assert from 'node:assert/strict';
import { normalizeApprovalConfig, approvalStageOutcome } from '../src/approvals.js';

const disabled = normalizeApprovalConfig(null);
assert.equal(disabled.enabled, false);
assert.equal(disabled.mode, 'all');
assert.deepEqual(disabled.approverIds, []);
assert.deepEqual(disabled.stages, []);
assert.deepEqual(disabled.tasks, []);

const config = normalizeApprovalConfig({
  enabled: true, mode: 'any',
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
assert.deepEqual(config.stages, [{ name: 'Approval', mode: 'any', approverIds: ['agent-1', 'agent-2'] }]);
assert.deepEqual(config.tasks, [
  { title: 'Provision laptop', description: 'Prepare and encrypt device', assigneeId: 'agent-2', position: 0 },
  { title: 'Create account', description: '', assigneeId: '', position: 2 }
]);

const sequential = normalizeApprovalConfig({
  enabled: true, mode: 'sequential',
  stages: [
    { name: 'Manager review', mode: 'any', approverIds: ['manager-1', 'manager-1'] },
    { name: 'Finance', mode: 'all', approverIds: ['finance-1', 'finance-2'] }
  ]
});
assert.equal(sequential.mode, 'sequential');
assert.deepEqual(sequential.stages, [
  { name: 'Manager review', mode: 'any', approverIds: ['manager-1'] },
  { name: 'Finance', mode: 'all', approverIds: ['finance-1', 'finance-2'] }
]);
assert.equal(approvalStageOutcome(sequential.stages[0], 0), 'pending');
assert.equal(approvalStageOutcome(sequential.stages[0], 1), 'complete');
assert.equal(approvalStageOutcome(sequential.stages[1], 1), 'pending');
assert.equal(approvalStageOutcome(sequential.stages[1], 2), 'complete');
assert.equal(approvalStageOutcome(sequential.stages[1], 1, 1), 'rejected');

const bounded = normalizeApprovalConfig({
  enabled: true, mode: 'unexpected',
  approverIds: Array.from({ length: 40 }, (_, i) => 'agent-' + i),
  tasks: Array.from({ length: 25 }, (_, i) => ({ title: 'Task ' + i }))
});
assert.equal(bounded.mode, 'all');
assert.equal(bounded.approverIds.length, 30);
assert.equal(bounded.stages.length, 1);
assert.equal(bounded.tasks.length, 20);
console.log('Approval configuration and stage tests passed.');
