// scripts/test-chat-poll-query-reuse.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8');
const conversationLookup = source.match(/async function conversationForNumber\([\s\S]*?\n\}/)?.[0] || '';
const poll = source.match(/export async function pollChat\([\s\S]*?\n\}/)?.[0] || '';

assert.match(conversationLookup, /left join "user" u on u\.id=cc\.assignee_id/,
  'conversation lookup should include the assigned agent details');
assert.match(conversationLookup, /u\.name as assignee_name,u\.email as assignee_email/,
  'conversation lookup should return both agent display fields');
assert.match(poll, /const t=await conversationForNumber\(c,x\.org\.id,number\)/,
  'visitor polling should reuse the joined conversation row');
assert.doesNotMatch(poll, /select (?:name,email|email) from "user"/,
  'visitor polling must not issue redundant sequential agent lookups');

console.log('ok  visitor polling reuses joined agent details without extra SQL round trips');
