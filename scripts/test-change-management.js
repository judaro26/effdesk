import assert from 'node:assert/strict';
import { normalizeChange, normalizeCabPolicy, DEFAULT_CAB_POLICY, CHANGE_TYPES, CHANGE_STATUSES, CHANGE_RISKS, CHANGE_TRANSITIONS } from '../src/change-management.js';
const empty=normalizeChange();
assert.equal(empty.changeType,'normal');
assert.equal(empty.status,'draft');
assert.equal(empty.risk,'medium');
assert.equal(empty.impact,'medium');
assert.equal(empty.plannedStart,null);
const change=normalizeChange({
 title:'  Database failover  ',description:' details ',changeType:'emergency',status:'awaiting_approval',
 risk:'critical',impact:'high',plannedStart:'2026-12-01T01:00:00Z',plannedEnd:'2026-12-01T02:00:00Z',
 implementationPlan:' step 1 ',testPlan:' verify ',rollbackPlan:' restore ',outcome:' done ',ownerId:' agent-1 '
});
assert.equal(change.title,'Database failover');
assert.equal(change.changeType,'emergency');
assert.equal(change.status,'awaiting_approval');
assert.equal(change.risk,'critical');
assert.equal(change.impact,'high');
assert.equal(change.plannedStart.toISOString(),'2026-12-01T01:00:00.000Z');
assert.equal(change.plannedEnd.toISOString(),'2026-12-01T02:00:00.000Z');
assert.equal(change.implementationPlan,'step 1');
assert.equal(change.ownerId,'agent-1');
assert.equal(normalizeChange({changeType:'bad',status:'bad',risk:'bad',impact:'bad'}).changeType,'normal');
assert.equal(normalizeChange({changeType:'bad',status:'bad',risk:'bad',impact:'bad'}).status,'draft');
assert.equal(normalizeChange({changeType:'bad',status:'bad',risk:'bad',impact:'bad'}).risk,'medium');
assert.deepEqual(CHANGE_TYPES,['standard','normal','emergency']);
assert.deepEqual(CHANGE_STATUSES,['draft','submitted','assessing','awaiting_approval','approved','rejected','scheduled','implementing','completed','failed','cancelled']);
assert.deepEqual(CHANGE_RISKS,['low','medium','high','critical']);
assert.equal(normalizeChange({title:'x'.repeat(240)}).title.length,180);
console.log('Change Management normalization tests passed.');

assert.deepEqual(CHANGE_TRANSITIONS.draft,['draft','submitted','assessing','awaiting_approval','cancelled']);
assert.deepEqual(CHANGE_TRANSITIONS.awaiting_approval,['awaiting_approval','approved','rejected','cancelled']);
assert.deepEqual(CHANGE_TRANSITIONS.implementing,['implementing','completed','failed']);
assert.deepEqual(CHANGE_TRANSITIONS.completed,['completed']);

const defaultPolicy=normalizeCabPolicy();
assert.deepEqual(defaultPolicy,DEFAULT_CAB_POLICY);
const policy=normalizeCabPolicy({
 conflictMode:'block',emergencyConflictOverride:true,
 requiredStages:{standard:-3,normal:3,emergency:99},
 minApproversByRisk:{low:0,medium:2,high:4,critical:50},
 standardMaxRisk:'medium',standardMaxImpact:'high'
});
assert.equal(policy.conflictMode,'block');
assert.equal(policy.emergencyConflictOverride,true);
assert.deepEqual(policy.requiredStages,{standard:0,normal:3,emergency:10});
assert.deepEqual(policy.minApproversByRisk,{low:1,medium:2,high:4,critical:30});
assert.equal(policy.standardMaxRisk,'medium');
assert.equal(policy.standardMaxImpact,'high');
assert.equal(normalizeCabPolicy({conflictMode:'anything',standardMaxRisk:'invalid'}).conflictMode,'warn');
assert.equal(normalizeCabPolicy({conflictMode:'anything',standardMaxRisk:'invalid'}).standardMaxRisk,'low');
console.log('CAB policy normalization tests passed.');
