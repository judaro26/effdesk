import assert from 'node:assert/strict';
import { normalizeSnmpDevices, isWithinAllowedNetwork } from '../src/cmdb-snmp.js';
const devices=normalizeSnmpDevices({devices:[
 {ip:'10.0.0.10',sysName:'core-switch',sysDescr:'Managed switch',sysObjectId:'1.3.6.1.4.1.9',sysUpTime:'123'},
 {ip:'8.8.8.8',sysName:'public-host',sysDescr:'should be rejected'},
 {ip:'192.168.1.5',sysDescr:'printer'},
 {ip:'not-an-ip',sysName:'bad'}
]});
assert.equal(devices.length,2);
assert.equal(devices[0].ip,'10.0.0.10');
assert.equal(devices[0].name,'core-switch');
assert.equal(devices[1].ip,'192.168.1.5');
console.log('SNMP payload normalization and private-address restriction passed.');

assert.equal(isWithinAllowedNetwork('192.168.1.22',['192.168.1.0/24']),true);
assert.equal(isWithinAllowedNetwork('192.168.2.22',['192.168.1.0/24']),false);
assert.equal(isWithinAllowedNetwork('8.8.8.8',['0.0.0.0/0']),false);
assert.equal(isWithinAllowedNetwork('fd00::1',['fd00::/64']),false);
