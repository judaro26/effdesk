// scripts/bench.js: HOW FAST IS IT WITH A LOT OF DATA? Seeds a throwaway Postgres (not part of npm test) and times the screens that run most. Usage: node scripts/bench.js [tickets]
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { listTickets, getTicket } from '../src/tickets.js';
import { dashboard } from '../src/dashboard.js';
import { report } from '../src/reports.js';
import { listTeam, agentDetail } from '../src/team.js';
import { exportData } from '../src/audit.js';
const N = Number(process.argv[2]) || Number(process.env.BENCH_TICKETS) || 100000;
const RUNS = Math.max(3, Math.min(30, Number(process.env.BENCH_RUNS) || 9));
const CONCURRENCY = Math.max(2, Math.min(100, Number(process.env.BENCH_CONCURRENCY) || 20));
const { url } = await freshDb('bench'); await migrate(url); const pool = makePool(url);
const orgs = ['big', ...Array.from({ length: 30 }, (_, i) => 'o' + i)];
for (const o of orgs) await pool.query('insert into "organization" (id, name, slug, "createdAt") values ($1,$1,$1,now())', [o]);
const u = (await pool.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") select 'u' || g, 'User ' || g, 'u' || g || '@x.test', true, now(), now() from generate_series(1, 20) g returning id`)).rows;
for (const o of orgs) await pool.query(`insert into member (id, "organizationId", "userId", role, "createdAt") select $1 || '-' || g, $1, 'u' || g, 'member', now() from generate_series(1, 20) g`, [o]);
const t0 = Date.now();
const seed = async (org, n) => {
  await pool.query(`insert into tickets (org_id, number, subject, status, priority, requester_name, requester_email, assignee_id, tags, created_at, updated_at, solved_at)
    select $1, g, 'Subject number ' || g || ' about ' || (array['billing','login','refund','shipping','outage'])[1 + g % 5], (array['open','pending','solved','solved','solved'])[1 + g % 5], 'normal', 'Name ' || g % 900, 'person' || g % 900 || '@client' || g % 40 || '.test', 'u' || (1 + g % 20), array['t' || g % 7],
      now() - (g || ' minutes')::interval * 7, now() - (g || ' minutes')::interval * 5, case when g % 5 >= 2 then now() - (g || ' minutes')::interval * 4 end from generate_series(1, $2) g`, [org, n]);
  await pool.query(`insert into ticket_messages (org_id, ticket_id, kind, author_id, author_name, body, created_at)
    select t.org_id, t.id, (array['requester','agent','requester','note'])[1 + m % 4], case when m % 4 in (1,3) then t.assignee_id end, 'Someone', 'Message ' || m || ' on ticket ' || t.number || ' lorem ipsum dolor sit amet', t.created_at + (m || ' minutes')::interval
    from tickets t cross join generate_series(0, 3) m where t.org_id = $1`, [org]);
  await pool.query('insert into ticket_counters (org_id, last) values ($1, $2) on conflict (org_id) do update set last = excluded.last', [org, n]).catch(() => {});
};
await seed('big', N); for (const o of orgs.slice(1)) await seed(o, Math.round(N / 100));
await pool.query('analyze');
console.log(`seeded ${N} tickets in the big workspace and ${orgs.length - 1} small ones in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
const me = { id: 'u1' }; const rows = [];
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
const time = async (name, fn, runs = RUNS) => {
  await fn(); // one warm-up run, excluded from the sample
  const samples = [];
  for (let i = 0; i < runs; i++) { const started = performance.now(); await fn(); samples.push(performance.now() - started); }
  samples.sort((a, b) => a - b);
  rows.push({ screen: name, runs, p50_ms: Number(percentile(samples, .50).toFixed(1)), p95_ms: Number(percentile(samples, .95).toFixed(1)), min_ms: Number(samples[0].toFixed(1)), max_ms: Number(samples[samples.length - 1].toFixed(1)) });
};
await time('ticket list (default)', () => listTickets(pool, 'big', me, {}));
await time('ticket list (active)', () => listTickets(pool, 'big', me, { status: 'active' }));
await time('ticket list (mine, open)', () => listTickets(pool, 'big', me, { assignee: 'me', status: 'open' }));
await time('ticket list (page 200)', () => listTickets(pool, 'big', me, { offset: 10000 }));
await time('ticket list (by tag)', () => listTickets(pool, 'big', me, { tag: 't3' }));
await time('ticket list (by queue none)', () => listTickets(pool, 'big', me, { queue: 'none' }));
await time('search "refund"', () => listTickets(pool, 'big', me, { q: 'refund' }));
await time('search by email', () => listTickets(pool, 'big', me, { q: 'person77@client7' }));
await time('open one ticket', () => getTicket(pool, 'big', me, 5000));
await time('dashboard', () => dashboard(pool, 'big', me, { sla: false, agents: 5 }));
await time('report (30 days)', () => report(pool, 'big', 30));
await time('team list', () => listTeam(pool, 'big', { seats: 99, plan: 'pro' }));
await time('agent detail', () => agentDetail(pool, 'big', 'u3', {}));
await time('export part 1', () => exportData(pool, 'big', 1), 3);
await time('ticket list (small workspace)', () => listTickets(pool, 'o3', me, {}));
await time('session-style lookups x4', async () => { for (let i = 0; i < 4; i++) await pool.query('select role from member where "userId" = $1 and "organizationId" = $2', ['u1', 'big']); });
const concurrent = async (name, fn, workers = CONCURRENCY, rounds = 3) => {
  for (let round = 0; round < rounds; round++) {
    const started = performance.now();
    const requests = Array.from({ length: workers }, async () => {
      const t = performance.now(); await fn(); return performance.now() - t;
    });
    // Sample pool pressure throughout the burst instead of taking a single
    // snapshot immediately after scheduling the promises.
    const poolPressure = { waiting: pool.waitingCount, total: pool.totalCount };
    const sampler = setInterval(() => {
      poolPressure.waiting = Math.max(poolPressure.waiting, pool.waitingCount);
      poolPressure.total = Math.max(poolPressure.total, pool.totalCount);
    }, 5);
    let batch;
    try { batch = await Promise.all(requests); } finally { clearInterval(sampler); }
    const sorted = batch.slice().sort((a, b) => a - b);
    rows.push({ screen: name + ' burst ' + (round + 1), runs: workers,
      batch_ms: Number((performance.now() - started).toFixed(1)),
      p50_ms: Number(percentile(sorted, .50).toFixed(1)),
      p95_ms: Number(percentile(sorted, .95).toFixed(1)),
      min_ms: Number(sorted[0].toFixed(1)), max_ms: Number(sorted[sorted.length - 1].toFixed(1)),
      pool_waiting_sampled_max: poolPressure.waiting, pool_total_sampled_max: poolPressure.total });
  }
};
await concurrent('ticket list concurrent', () => listTickets(pool, 'big', me, {}));
await concurrent('dashboard concurrent', () => dashboard(pool, 'big', me, { sla: false, agents: 5 }));
// A small tenant continues serving requests while the large tenant is busy.
// This makes cross-tenant contention visible instead of measuring the small
// workspace only in isolation.
for (let round = 0; round < 3; round++) {
  const started = performance.now(), latency = { big: [], small: [] };
  const poolPressure = { waiting: pool.waitingCount, total: pool.totalCount };
  const sampler = setInterval(() => {
    poolPressure.waiting = Math.max(poolPressure.waiting, pool.waitingCount);
    poolPressure.total = Math.max(poolPressure.total, pool.totalCount);
  }, 5);
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, async (_, i) => {
      const tenant = i % 5 === 0 ? 'small' : 'big', t = performance.now();
      await listTickets(pool, tenant === 'small' ? 'o3' : 'big', me, {});
      latency[tenant].push(performance.now() - t);
    }));
  } finally { clearInterval(sampler); }
  for (const tenant of ['big', 'small']) {
    const sorted = latency[tenant].sort((a, b) => a - b);
    if (!sorted.length) continue;
    rows.push({ screen: 'mixed-tenant ' + tenant + ' burst ' + (round + 1), runs: sorted.length,
      batch_ms: Number((performance.now() - started).toFixed(1)),
      p50_ms: Number(percentile(sorted, .50).toFixed(1)), p95_ms: Number(percentile(sorted, .95).toFixed(1)),
      min_ms: Number(sorted[0].toFixed(1)), max_ms: Number(sorted[sorted.length - 1].toFixed(1)),
      pool_waiting_sampled_max: poolPressure.waiting, pool_total_sampled_max: poolPressure.total });
  }
}
console.log('\nPool pressure after concurrent bursts (max ' + pool.options.max + '): total=' + pool.totalCount + ', idle=' + pool.idleCount + ', waiting=' + pool.waitingCount + '; configured concurrency=' + CONCURRENCY + '.');

console.log(`\nBenchmark summary: ${N.toLocaleString()} tickets in the primary tenant; ${RUNS} measured runs per screen (plus one warm-up); concurrency bursts used ${CONCURRENCY} workers x 3 rounds.`);
console.table(rows);
await pool.end(); process.exit(0);
