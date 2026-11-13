import assert from 'node:assert/strict';
import { normalizeSoftwareName, normalizeComplianceRules, evaluateCompliancePolicy } from '../src/cmdb-governance.js';

assert.equal(normalizeSoftwareName('  Microsoft   365 Apps  '),'microsoft 365 apps');
assert.deepEqual(normalizeComplianceRules({requireOwner:true,requireAssetTag:1,maxDiscoveryAgeDays:99999}),{
 requireOwner:true,requireAssetTag:false,requireSerial:false,requireDiscovery:false,requireWarranty:false,maxDiscoveryAgeDays:null
});
const policy={id:7,name:'Managed endpoint baseline',severity:'high',rules:{requireOwner:true,requireAssetTag:true,requireSerial:true,requireDiscovery:true,requireWarranty:true,maxDiscoveryAgeDays:30}};
const missing=evaluateCompliancePolicy(policy,{id:1,asset_tag:'',owner_id:null,serial_number:'',discovery_source:null,warranty_expires_at:null,discovery_last_seen_at:null});
assert.equal(missing.status,'failed');
assert.equal(missing.issues.length,6);
const good=evaluateCompliancePolicy(policy,{id:2,asset_tag:'LAP-2',owner_id:'user-2',serial_number:'S-2',discovery_source:'windows_agent',warranty_expires_at:'2099-12-31',discovery_last_seen_at:new Date().toISOString()});
assert.equal(good.status,'passed');
assert.deepEqual(good.issues,[]);
console.log('CMDB governance normalization and compliance evaluation passed.');
