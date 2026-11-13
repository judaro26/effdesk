import assert from 'node:assert/strict';
import { createWindowsAgent, listWindowsAgents } from '../src/cmdb-agent.js';
assert.equal(typeof createWindowsAgent,'function');
assert.equal(typeof listWindowsAgents,'function');
console.log('Windows discovery agent module exports passed.');
