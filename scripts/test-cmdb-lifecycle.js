import assert from 'node:assert/strict';
import { parseCsv, toCsv, normalizeVendor } from '../src/cmdb-lifecycle.js';
const rows=parseCsv('asset_tag,name,description\nA-1,"Laptop, finance","Line 1\nLine 2"\nA-2,"A ""quoted"" server",ok');
assert.equal(rows.length,2);assert.equal(rows[0].asset_tag,'A-1');assert.equal(rows[0].name,'Laptop, finance');assert.equal(rows[0].description,'Line 1\nLine 2');assert.equal(rows[1].name,'A "quoted" server');
assert.equal(parseCsv('asset_tag,name\n')[0],undefined);
assert.throws(()=>parseCsv('a,a\n1,2'),/unique/);assert.throws(()=>parseCsv('a,b\n"oops,ok'),/unclosed/);
assert.equal(toCsv(['name','note'],[{name:'A, B',note:'a "quote"'}]),'name,note\r\n"A, B","a ""quote"""');
assert.deepEqual(normalizeVendor({name:' Acme ',website:' https://example.com ',supportEmail:'x@y.com'}),{name:'Acme',website:'https://example.com',supportEmail:'x@y.com',supportPhone:'',notes:''});
console.log('CMDB lifecycle and CSV tests passed.');
