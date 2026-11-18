// Read-only hot-tenant fairness test against the dedicated synthetic staging database.
// 70% of requests target one busy tenant; the remaining 30% are distributed across peers.
import { getPool } from '../src/db.js';
import { listTickets } from '../src/tickets.js';
import { dashboard } from '../src/dashboard.js';
import { report } from '../src/reports.js';
import { agentInbox } from '../src/chat.js';
import { parseFairnessOrgIds, buildFairnessTasks, summarizeFairness } from './lib/staging-tenant-fairness.js';

const rawUrl = process.env.STAGING_DATABASE_URL;
const orgIds = parseFairnessOrgIds(process.env.STAGING_ORG_IDS);
const profile = String(process.env.STAGING_BENCH_PROFILE || 'smoke').toLowerCase();
const profiles = { smoke: { concurrency: 5, rounds: 2 }, standard: { concurrency: 15, rounds: 3 }, stress: { concurrency: 30, rounds: 3 } };
const settings = profiles[profile];

function validateTarget(value) {
  if (!value) throw new Error('STAGING_DATABASE_URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('STAGING_DATABASE_URL must be a valid PostgreSQL URL.'); }
  const host = url.hostname.toLowerCase();
  const dbName = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host.endsWith('.neon.tech') || !host.includes('-pooler')) {
    throw new Error('Refusing to run: use the dedicated pooled Neon staging connection string.');
  }
  if (!/(^|[_-])(staging|stage|test)([_-]|$)/.test(dbName)) throw new Error('Refusing to run: database name must contain staging, stage, or test.');
  if (!settings) throw new Error('STAGING_BENCH_PROFILE must be smoke, standard, or stress.');
  return { host, dbName };
}
const target = validateTarget(rawUrl);
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ safe: true, host: target.host, database: target.dbName, workspaces: orgIds.length, profile }));
  process.exit(0);
}

const pool = getPool(rawUrl);
const actor = { id: process.env.STAGING_BENCH_AGENT_ID || '__effdesk_staging_load_test__' };
const scenarios = {
  'ticket inbox': org => listTickets(pool, org, actor, { limit: 50, cursorMode: true }),
  'agent dashboard': org => dashboard(pool, org, actor, { sla: false, agents: 5 }),
  'live chat inbox': org => agentInbox(pool, org, { view: 'all', limit: 50, cursorMode: true }),
  '30-day reports': org => report(pool, org, 30)
};
const tasks = buildFairnessTasks(orgIds, settings.rounds);
const samples = [];
let cursor = 0, maxWaiting = 0, maxTotal = 0;
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
      const task = tasks[index], at = performance.now();
      try {
        const result = await scenarios[task.scenario](task.orgId);
        if (result?.ok === false) throw new Error(result.error || 'scenario returned an unsuccessful result');
        samples.push({ ...task, ok: true, ms: performance.now() - at });
      } catch (error) {
        samples.push({ ...task, ok: false, ms: performance.now() - at });
        console.error(JSON.stringify({ tenant_class: task.tenantClass, scenario: task.scenario, error: String(error?.message || error).slice(0, 200) }));
      }
    }
  }));
} finally {
  clearInterval(sampler);
}
const elapsed = performance.now() - started;
const summary = summarizeFairness(samples);
console.log(JSON.stringify({
  target: { host: target.host, database: target.dbName },
  workload: 'read-only; 70% of requests to the first synthetic workspace, 30% spread across remaining workspaces',
  profile, workspaces: orgIds.length, concurrency: settings.concurrency,
  measured: { requests: tasks.length, elapsed_ms: Number(elapsed.toFixed(1)), requests_per_second: Number((tasks.length / Math.max(elapsed, 1) * 1000).toFixed(1)), failures: samples.filter(x => !x.ok).length },
  pool: { max: pool.options.max, max_total_sampled: maxTotal, max_waiting_sampled: maxWaiting },
  tenant_fairness: summary
}, null, 2));
await pool.end();
if (samples.some(x => !x.ok)) process.exitCode = 1;
