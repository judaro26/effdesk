// scripts/test-dashboard-single-roundtrip.js
import assert from 'node:assert/strict';
import { dashboard } from '../src/dashboard.js';

const statements = [];
let releases = 0;
const client = {
  escapeLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; },
  async query(sql, args) {
    statements.push({ sql: String(sql), args });
    const normalized = String(sql).trim().toLowerCase();
    if (normalized.startsWith('with ticket_counts as')) {
      return { rows: [{
        open: 4, pending: 2, on_hold: 1, unassigned: 3, mine: 2, urgent: 1,
        new_today: 2, solved_today: 1, solved_week: 5, total: 8,
        mine: [{ number: 11, subject: 'Assigned', status: 'open', priority: 'high', requester_name: 'A', requester_email: 'a@example.invalid', updated_at: '2026-11-15T10:00:00Z' }],
        unassigned: [], recent: [], daily: [{ label: 'Sun', created: 2, solved: 1 }],
        articles: 1, inbox: true, slug: 'example'
      }] };
    }
    return { rows: [] };
  },
  release() { releases++; }
};
const pool = { async connect() { return client; } };
const result = await dashboard(pool, 'org-dashboard-test', { id: 'agent-1' }, { agents: 2, portalDomain: 'help.example.com' });

const dashboardQueries = statements.filter(x => /with ticket_counts as/i.test(x.sql));
assert.equal(dashboardQueries.length, 1, 'dashboard core data should use one SQL query');
assert.deepEqual(dashboardQueries[0].args, ['org-dashboard-test', 'agent-1']);
assert.equal(result.ok, true);
assert.equal(result.portal, 'https://example.help.example.com');
assert.deepEqual(result.counts, {
  open: 4, pending: 2, on_hold: 1, unassigned: 3, mine: 2, urgent: 1,
  newToday: 2, solvedToday: 1, solvedWeek: 5, breached: null
});
assert.deepEqual(result.mine, [{
  number: 11, subject: 'Assigned', status: 'open', priority: 'high',
  requester: 'A', updatedAt: '2026-11-15T10:00:00Z'
}]);
assert.deepEqual(result.daily, [{ label: 'Sun', created: 2, solved: 1 }]);
assert.deepEqual(result.setup, { inbox: true, articles: true, team: true, firstTicket: true });
assert.equal(statements.filter(x => /^commit$/i.test(x.sql.trim())).length, 1);
assert.equal(releases, 1);
console.log('ok  dashboard aggregates and pages are loaded in one tenant-scoped SQL round trip');
