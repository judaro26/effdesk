import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFairnessOrgIds, buildFairnessTasks, percentileStats, summarizeFairness } from './lib/staging-tenant-fairness.js';

test('accepts and de-duplicates only synthetic staging workspaces', () => {
  assert.deepEqual(parseFairnessOrgIds('stg_effdesk_org_01,stg_effdesk_org_02,stg_effdesk_org_01'), ['stg_effdesk_org_01','stg_effdesk_org_02']);
  assert.throws(() => parseFairnessOrgIds('stg_effdesk_org_01'));
  assert.throws(() => parseFairnessOrgIds('prod_org_01,stg_effdesk_org_02'));
  assert.throws(() => parseFairnessOrgIds('stg_effdesk_org_31,stg_effdesk_org_02'));
});

test('concentrates 70 percent of deterministic workload on one hot tenant', () => {
  const ids = Array.from({length:10},(_,i)=>'stg_effdesk_org_'+String(i+1).padStart(2,'0'));
  const tasks = buildFairnessTasks(ids, 2);
  const hot = tasks.filter(x=>x.tenantClass==='hot');
  const control = tasks.filter(x=>x.tenantClass==='control');
  assert.equal(tasks.length, 80);
  assert.equal(hot.length, 56);
  assert.equal(control.length, 24);
  assert.equal(new Set(hot.map(x=>x.orgId)).size, 1);
  assert.equal(new Set(control.map(x=>x.orgId)).size, 9);
  assert.equal(new Set(tasks.map(x=>x.scenario)).size, 4);
});

test('calculates empty and populated latency percentiles', () => {
  assert.deepEqual(percentileStats([]), {samples:0,p50_ms:null,p95_ms:null,p99_ms:null,max_ms:null});
  assert.deepEqual(percentileStats([5,1,4,2,3]), {samples:5,p50_ms:3,p95_ms:5,p99_ms:5,max_ms:5});
});

test('reports hot-tenant and control-tenant results separately', () => {
  const result = summarizeFairness([
    {tenantClass:'hot',orgId:'stg_effdesk_org_01',scenario:'ticket inbox',ok:true,ms:100},
    {tenantClass:'control',orgId:'stg_effdesk_org_02',scenario:'ticket inbox',ok:true,ms:20},
    {tenantClass:'control',orgId:'stg_effdesk_org_03',scenario:'ticket inbox',ok:false,ms:50}
  ]);
  assert.equal(result.hot.latency.p50_ms,100);
  assert.equal(result.control.latency.p50_ms,20);
  assert.equal(result.control.failures,1);
  assert.equal(result.hot.organizations,1);
  assert.equal(result.control.organizations,2);
});
