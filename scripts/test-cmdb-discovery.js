import assert from 'node:assert/strict';
import { isValidTenant, normalizeDevice } from '../src/cmdb-discovery.js';
assert.equal(isValidTenant('00000000-0000-0000-0000-000000000000'),true);
assert.equal(isValidTenant('contoso.onmicrosoft.com'),true);
assert.equal(isValidTenant('common'),false);
assert.equal(isValidTenant('https://evil.example'),false);
assert.deepEqual(normalizeDevice({id:'abc-123',deviceName:'  Laptop  ',manufacturer:'Contoso',model:'X1',serialNumber:'S-1',operatingSystem:'Windows',osVersion:'11',complianceState:'compliant',managedDeviceOwnerType:'company',userPrincipalName:'user@example.com'}),{
 id:'abc-123',name:'Laptop',manufacturer:'Contoso',model:'X1',serial:'S-1',os:'Windows',osVersion:'11',compliance:'compliant',ownerType:'company',user:'user@example.com',lastSync:null
});
assert.equal(normalizeDevice({deviceName:'Missing ID'}),null);
console.log('CMDB discovery validation passed.');
