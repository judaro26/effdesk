// scripts/test-report-transaction.js: report reads keep all tenant data in one transaction.
import assert from 'node:assert/strict';
import { report } from '../src/reports.js';

const statements = [];
let releases = 0;
const client = {
  escapeLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; },
  async query(sql) {
    statements.push(String(sql));
    const normalized = String(sql).trim().toLowerCase();
    if (normalized.startsWith('select priority, first_response_min')) return { rows: [] };
    if (normalized.startsWith('select enabled, tz, schedule from sla_hours')) return { rows: [] };
    if (normalized.startsWith('select t.number, t.subject')) return { rows: [] };
    if (normalized.startsWith('select t.created_at, t.first_response_at')) return { rows: [] };
    if (normalized.startsWith('select count(*) filter (where status')) return { rows: [{ active: 0, waiting: 0 }] };
    if (normalized.startsWith('select coalesce(u.name')) return { rows: [] };
    if (normalized.startsWith('with d as')) return { rows: [] };
    if (normalized.startsWith('select count(*)::int sent')) return { rows: [{ sent: 0, rated: 0, good: 0 }] };
    return { rows: [] };
  },
  release() { releases++; }
};
const pool = { async connect() { return client; } };
const result = await report(pool, 'org-report-test', 30, Date.parse('2026-11-15T12:00:00Z'));
const commits = statements.filter(sql => /^commit$/i.test(sql.trim())).length;
const begins = statements.filter(sql => /^begin;/i.test(sql.trim())).length;
assert.equal(result.ok, true);
assert.equal(result.days, 30);
assert.equal(begins, 1, 'report should begin exactly one tenant-scoped transaction');
assert.equal(commits, 1, 'report should commit exactly one tenant-scoped transaction');
assert.equal(releases, 1, 'report should release its database client once');
assert.ok(statements.some(sql => /from sla_policies where org_id = \$1/i.test(sql)));
assert.ok(statements.some(sql => /from sla_hours where org_id = \$1/i.test(sql)));
console.log('ok  report loads SLA, business hours, and report data in one tenant transaction');
