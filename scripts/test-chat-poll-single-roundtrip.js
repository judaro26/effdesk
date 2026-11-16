// scripts/test-chat-poll-single-roundtrip.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/chat.js', import.meta.url), 'utf8');
const poll = source.match(/export async function pollChat\([\s\S]*?\n\}/)?.[0] || '';
const liveOrg = source.match(/async function liveOrg\([\s\S]*?\n\}/)?.[0] || '';

assert.ok(poll, 'visitor poll implementation should exist');
assert.match(poll, /return withOrg\(pool,x\.org\.id,async c=>/,
  'visitor poll must retain tenant-scoped RLS transaction');
assert.equal((poll.match(/c\.query\(/g) || []).length, 1,
  'visitor poll should use one SQL query inside its tenant transaction');
assert.match(poll, /with target as materialized/,
  'poll query should resolve the conversation once');
assert.match(poll, /update chat_conversations cc[\s\S]*?last_visitor_seen_at/,
  'poll query should preserve the visitor-presence heartbeat');
assert.match(poll, /recent_messages as materialized/,
  'poll query should fetch recent messages in the same round trip');
assert.match(poll, /from attachments a[\s\S]*?chat_message_id=rm\.id/,
  'poll query should include message attachments');
assert.match(poll, /from chat_presence p[\s\S]*?agent_typing/,
  'poll query should include agent typing state');
assert.match(liveOrg, /LIVE_ORG_CACHE_MS = 5000/,
  'public chat configuration should use a short bounded cache');
assert.match(source, /invalidateLiveOrgCache\(orgId\)/,
  'saving chat settings should invalidate the cached widget configuration');

console.log('ok  visitor polling uses one tenant-scoped SQL round trip and a short invalidated config cache');
