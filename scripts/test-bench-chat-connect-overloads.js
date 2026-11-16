import fs from 'node:fs';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('./bench-chat-mixed.js',import.meta.url),'utf8');
assert.match(source,/pool\.connect=function\(\.\.\.args\)/,'wraps pool connect without forcing an async return');
assert.match(source,/if\(typeof args\[0\]==='function'\)/,'preserves the callback overload');
assert.match(source,/args\[0\]=\(error,client,release\)=>/,'instruments callback clients after acquisition');
assert.match(source,/return connect\(\.\.\.args\)\.then\(client=>/,'preserves the promise overload');
assert.match(source,/instrumentClient\(client\)/,'instruments acquired clients safely');
assert.match(source,/if\(!client \|\| client\.__effdeskMixedQueryTiming\)return/,'guards missing or already-instrumented clients');
console.log('✓ mixed chat benchmark pool-connect overload checks passed');
