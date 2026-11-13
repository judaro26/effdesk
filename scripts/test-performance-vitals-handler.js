import { check, done } from './lib/check.js';
import { performanceVitals } from '../src/handlers.js';
const writes = [];
let member = true;
const pool = {
  query: async (sql, params) => {
    if (sql.startsWith('select role from member')) return { rows: member ? [{ role: 'member' }] : [] };
    if (sql.includes('insert into rate_hits')) return { rows: [{ n: 1 }] };
    if (sql.startsWith('delete from rate_hits')) return { rows: [], rowCount: 0 };
    if (sql.includes('insert into performance_vitals_minute')) { writes.push(params); return { rows: [], rowCount: 1 }; }
    throw new Error('Unexpected query in performance-vitals handler test: ' + sql.slice(0, 80));
  }
};
const auth = { api: { getSession: async () => ({ user: { id: 'user-1' } }) } };
const deps = { pool, auth, env: {} };
const post = (body) => new Request('https://app.test/api/performance-vitals', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
});
const ok = await performanceVitals(post({ orgId: 'org-1', name: 'LCP', value: 1800, page: '/agent/10003/tickets', device: 'desktop' }), deps);
check('accepts a valid authenticated member performance sample', ok.status === 202 && writes.length === 1);
member = false;
const denied = await performanceVitals(post({ orgId: 'org-2', name: 'LCP', value: 1800 }), deps);
check('rejects samples for a workspace the user is not a member of', denied.status === 403 && writes.length === 1);
member = true;
const invalid = await performanceVitals(post({ orgId: 'org-1', name: 'PASSWORD', value: 100 }), deps);
check('rejects unsupported metric names', invalid.status === 400 && writes.length === 1);
const wrongMethod = await performanceVitals(new Request('https://app.test/api/performance-vitals'), deps);
check('accepts POST only', wrongMethod.status === 405);
done();
