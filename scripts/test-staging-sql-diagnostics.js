import assert from 'node:assert/strict';
import { normalizeSqlForFingerprint, sanitizeSqlTemplate } from './staging-sql-diagnostics.js';

assert.equal(normalizeSqlForFingerprint(' SELECT  *\n FROM tickets '), 'SELECT * FROM tickets');
assert.equal(
  sanitizeSqlTemplate("SELECT * FROM tickets WHERE org_id = $1 AND status = 'private customer text' AND created_at > 2026-11-15 LIMIT 50 -- customer note"),
  "SELECT * FROM tickets WHERE org_id = $1 AND status = '?' AND created_at > ?-?-? LIMIT ?"
);
assert.equal(
  sanitizeSqlTemplate("SELECT $$sensitive payload$$, $tag$more private text$tag$ FROM t"),
  "SELECT '?', '?' FROM t"
);
assert.equal(sanitizeSqlTemplate('SELECT 1', 4), 'SELE… [truncated]');
console.log('staging SQL diagnostic sanitization tests passed');
