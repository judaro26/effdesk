// Read-only multi-tenant load test against a dedicated staging Neon database.
// No records are created, updated, or deleted. Results contain timings only.
import pg from 'pg';
import { createHash } from 'node:crypto';
import { normalizeSqlForFingerprint, sanitizeSqlTemplate } from './staging-sql-diagnostics.js';
import { explicitSsl } from '../src/db.js';
import { listTickets } from '../src/tickets.js';
import { dashboard } from '../src/dashboard.js';
import { report } from '../src/reports.js';
import { agentInbox } from '../src/chat.js';

const rawUrl = process.env.STAGING_DATABASE_URL;
const orgIds = [...new Set(String(process.env.STAGING_ORG_IDS || '').split(',').map(x => x.trim()).filter(Boolean))];
const profile = String(process.env.STAGING_BENCH_PROFILE || 'smoke').toLowerCase();
const profiles = { smoke: { concurrency: 5, rounds: 2 }, standard: { concurrency: 15, rounds: 3 }, stress: { concurrency: 30, rounds: 3 } };
const settings = profiles[profile];
const percentile = (values, p) => values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)];
const round = n => Number(n.toFixed(1));

function validateTarget(value) {
  if (!value) throw new Error('STAGING_DATABASE_URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('STAGING_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('STAGING_DATABASE_URL must use postgres:// or postgresql://.');
  const host = url.hostname.toLowerCase();
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, '')).toLowerCase();
  if (!host.endsWith('.neon.tech') || !host.includes('-pooler')) throw new Error('Refusing to run: use the dedicated Neon pooled staging connection string (host must end in .neon.tech and include -pooler).');
  if (!/(^|[_-])(staging|stage|test)([_-]|$)/.test(dbName)) throw new Error('Refusing to run: the database name must explicitly contain staging, stage, or test.');
  if (!settings) throw new Error('STAGING_BENCH_PROFILE must be smoke, standard, or stress.');
  if (orgIds.length < 2 || orgIds.length > 30) throw new Error('STAGING_ORG_IDS must contain between 2 and 30 comma-separated synthetic staging workspace IDs.');
  return { host, dbName };
}

if (process.argv.includes('--check')) {
  validateTarget(rawUrl);
  console.log('Staging load-test configuration is safe.');
  process.exit(0);
}

const target = validateTarget(rawUrl);
const pool = new pg.Pool({
  connectionString: explicitSsl(rawUrl),
  max: 10,
  idleTimeoutMillis: 10000,
  ssl: { rejectUnauthorized: true }
});
// Capture query-level timings with redacted SQL shapes; never log bind values or tenant/customer content.
const querySamples = new Map();
const connect = pool.connect.bind(pool);
pool.connect = async (...args) => {
  const client = await connect(...args);
  if (!client.__effdeskQueryTiming) {
    client.__effdeskQueryTiming = true;
    const originalQuery = client.query.bind(client);
    client.query = (...queryArgs) => {
      // Application paths use promise-based pg queries. Preserve callback semantics unchanged.
      if (queryArgs.some(value => typeof value === 'function')) return originalQuery(...queryArgs);
      const input = queryArgs[0];
      const sql = typeof input === 'string' ? input : input?.text || '';
      const normalizedSql = normalizeSqlForFingerprint(sql);
      const fingerprint = createHash('sha256').update(normalizedSql).digest('hex').slice(0, 12);
      const sqlTemplate = sanitizeSqlTemplate(sql);
      const startedAt = performance.now();
      const record = error => {
        let entry = querySamples.get(fingerprint);
        if (!entry) { entry = { durations: [], errors: 0, sql_template: sqlTemplate }; querySamples.set(fingerprint, entry); }
        entry.durations.push(performance.now() - startedAt);
        if (error) entry.errors++;
      };
      try {
        const result = originalQuery(...queryArgs);
        return result && typeof result.then === 'function'
          ? result.then(value => { record(null); return value; }, error => { record(error); throw error; })
          : result;
      } catch (error) { record(error); throw error; }
    };
  }
  return client;
};
const actor = { id: process.env.STAGING_BENCH_AGENT_ID || '__effdesk_staging_load_test__' };
const scenarios = [
  { name: 'ticket inbox', run: org => listTickets(pool, org, actor, { limit: 50, cursorMode: true }) },
  { name: 'agent dashboard', run: org => dashboard(pool, org, actor, { sla: false, agents: 5 }) },
  { name: 'live chat inbox', run: org => agentInbox(pool, org, { view: 'all', limit: 50, cursorMode: true }) },
  { name: '30-day reports', run: org => report(pool, org, 30) }
];
const samples = Object.fromEntries(scenarios.map(s => [s.name, []]));
const failures = Object.fromEntries(scenarios.map(s => [s.name, 0]));
let cursor = 0, maxWaiting = 0, maxTotal = 0;
const tasks = [];
for (let r = 0; r < settings.rounds; r++) {
  for (const scenario of scenarios) {
    for (const org of orgIds) tasks.push({ scenario, org });
  }
}
const sampler = setInterval(() => {
  maxWaiting = Math.max(maxWaiting, pool.waitingCount);
  maxTotal = Math.max(maxTotal, pool.totalCount);
}, 5);
const started = performance.now();
try {
  await Promise.all(Array.from({ length: settings.concurrency }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      const task = tasks[index], t = performance.now();
      try {
        const result = await task.scenario.run(task.org);
        if (result && result.ok === false) throw new Error('scenario returned an unsuccessful result');
        samples[task.scenario.name].push(performance.now() - t);
      } catch (error) {
        failures[task.scenario.name]++;
        console.error(JSON.stringify({ scenario: task.scenario.name, workspace: task.org, error: String(error?.message || error).slice(0, 240) }));
      }
    }
  }));
} finally {
  clearInterval(sampler);
}
const elapsed = performance.now() - started;
const summary = scenarios.map(s => {
  const values = samples[s.name].sort((a, b) => a - b);
  return {
    scenario: s.name,
    requests: values.length + failures[s.name],
    failures: failures[s.name],
    p50_ms: values.length ? round(percentile(values, .50)) : null,
    p95_ms: values.length ? round(percentile(values, .95)) : null,
    p99_ms: values.length ? round(percentile(values, .99)) : null,
    max_ms: values.length ? round(values.at(-1)) : null
  };
});
const queryDiagnostics = [...querySamples.entries()].map(([fingerprint, entry]) => {
  const values = entry.durations.sort((a, b) => a - b);
  return { fingerprint, sql_template: entry.sql_template, calls: values.length, errors: entry.errors, total_ms: round(values.reduce((sum, value) => sum + value, 0)), p50_ms: round(percentile(values, .50)), p95_ms: round(percentile(values, .95)), max_ms: round(values.at(-1)) };
}).sort((a, b) => b.total_ms - a.total_ms).slice(0, 12);
console.log(JSON.stringify({
  target: { host: target.host, database: target.dbName },
  profile,
  workspaces: orgIds.length,
  concurrency: settings.concurrency,
  elapsed_ms: round(elapsed),
  requests_per_second: round((tasks.length / Math.max(elapsed, 1)) * 1000),
  pool: { max: pool.options.max, max_total_sampled: maxTotal, max_waiting_sampled: maxWaiting },
  scenarios: summary,
  top_query_fingerprints: queryDiagnostics
}, null, 2));
await pool.end();
if (summary.some(x => x.failures > 0)) process.exitCode = 1;
