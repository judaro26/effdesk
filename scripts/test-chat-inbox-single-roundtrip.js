// scripts/test-chat-inbox-single-roundtrip.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8');
const inbox = source.match(/export async function agentInbox\([\s\S]*?(?=\n\/\/ Lightweight notification feed)/)?.[0] || '';

assert.ok(inbox, 'agent inbox implementation should exist');
assert.match(inbox, /return withOrg\(pool,orgId,async c=>/,
  'agent inbox must retain its tenant-scoped RLS transaction');
assert.equal((inbox.match(/c\.query\(/g) || []).length, 2,
  'agent inbox should use one conversation-page query and one combined metadata query');
assert.match(inbox, /with conversation_counts as \(/,
  'inbox metadata should aggregate conversation counts in one SQL statement');
assert.match(inbox, /needs_reply[\s\S]*?\(\$\{latest\}\)='requester'/,
  'combined metadata should preserve needs-reply counting');
assert.match(inbox, /cc\.assignee_id=\$2 and cc\.status in \('open','pending','on_hold'\)\)::int active/,
  'combined metadata should calculate the selected agent active-chat count');
assert.match(inbox, /select max_concurrent from chat_settings where org_id=\$1/,
  'combined metadata should include the workspace chat capacity setting');
assert.match(inbox, /from chat_conversations cc where cc\.org_id=\$1/,
  'conversation aggregates must remain scoped to the current workspace');
assert.ok(inbox.includes("[orgId,String(input.agentId||'')]"),
  'metadata query should bind the workspace and agent identifiers');

console.log('ok  agent inbox loads its page and combined tenant-scoped metadata in two SQL round trips');
