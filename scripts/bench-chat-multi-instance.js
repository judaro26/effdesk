// Launch independent Node.js workers, each with its own production-configured DB pool.
// This approximates multiple application instances while keeping all work on guarded synthetic staging data.
import { spawn } from 'node:child_process';

const rawUrl = process.env.STAGING_DATABASE_URL;
const orgIds = [...new Set(String(process.env.STAGING_ORG_IDS || '').split(',').map(x => x.trim()).filter(Boolean))];
const profile = String(process.env.STAGING_BENCH_PROFILE || 'smoke').toLowerCase();
const instances = Number(process.env.STAGING_BENCH_INSTANCES || 3);
const profiles = { smoke: 5, standard: 15, stress: 30 };

function validateTarget(value) {
  if (!value) throw new Error('STAGING_DATABASE_URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('STAGING_DATABASE_URL must be a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('STAGING_DATABASE_URL must use postgres:// or postgresql://.');
  const host = url.hostname.toLowerCase();
  const dbName = decodeURIComponent(url.pathname.slice(1)).toLowerCase();
  if (!host.endsWith('.neon.tech') || !host.includes('-pooler')) throw new Error('Refusing to run: use the dedicated Neon pooled staging connection string.');
  if (!/(^|[_-])(staging|stage|test)([_-]|$)/.test(dbName)) throw new Error('Refusing to run: database name must contain staging, stage, or test.');
  if (!profiles[profile]) throw new Error('STAGING_BENCH_PROFILE must be smoke, standard, or stress.');
  if (!Number.isInteger(instances) || instances < 2 || instances > 3) throw new Error('STAGING_BENCH_INSTANCES must be 2 or 3.');
  if (orgIds.length < 2 || orgIds.length > 30) throw new Error('STAGING_ORG_IDS must contain 2–30 synthetic staging workspace IDs.');
  return { host, database: dbName };
}

const target = validateTarget(rawUrl);
if (process.argv.includes('--check')) {
  console.log('Multi-instance Live Chat benchmark staging target is safe.');
  process.exit(0);
}

const perInstanceConcurrency = Math.max(1, Math.ceil(profiles[profile] / instances));
const workers = [];
for (let index = 0; index < instances; index++) {
  const child = spawn(process.execPath, ['scripts/bench-chat-mixed.js'], {
    env: {
      ...process.env,
      STAGING_BENCH_CONCURRENCY: String(perInstanceConcurrency),
      STAGING_BENCH_COORDINATED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  workers.push({ index: index + 1, child, stdout: '', stderr: '', ready: false });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { workers[index].stdout += chunk; });
  child.stderr.on('data', chunk => { workers[index].stderr += chunk; });
}

const allReady = new Promise((resolve, reject) => {
  for (const worker of workers) {
    worker.child.on('message', message => {
      if (message?.type !== 'warmup-complete' || worker.ready) return;
      worker.ready = true;
      if (workers.every(item => item.ready)) resolve();
    });
    worker.child.on('error', reject);
    worker.child.on('exit', code => {
      if (!workers.every(item => item.ready)) reject(new Error(`Benchmark instance ${worker.index} exited before all workers reached the warm-up barrier (code ${code}). ${worker.stderr.slice(-1200)}`));
    });
  }
});
const exitPromises = workers.map(worker => new Promise((resolve, reject) => {
  worker.child.once('error', reject);
  worker.child.once('exit', code => resolve({ worker, code }));
}));

try {
  await allReady;
  // All workers have their own pool, completed setup and warm-up, and are ready.
  // Release the measured phase together to make aggregate throughput meaningful.
  for (const worker of workers) worker.child.send({ type: 'start-measured' });

  const exits = await Promise.all(exitPromises);
  const results = exits.map(({ worker, code }) => {
    if (code !== 0) throw new Error(`Benchmark instance ${worker.index} failed with exit code ${code}: ${worker.stderr.slice(-1600)}`);
    let result;
    try { result = JSON.parse(worker.stdout.trim()); }
    catch { throw new Error(`Could not parse instance ${worker.index} benchmark output. stdout: ${worker.stdout.slice(-1200)} stderr: ${worker.stderr.slice(-1200)}`); }
    return { instance: worker.index, result };
  });

  const measuredRequests = results.reduce((sum, item) => sum + item.result.measured.requests, 0);
  const failures = results.reduce((sum, item) => sum + item.result.measured.failures, 0);
  const elapsedMs = Math.max(...results.map(item => item.result.measured.elapsed_ms));
  const totalPoolMax = results.reduce((sum, item) => sum + item.result.pool.max, 0);
  const totalConnections = results.reduce((sum, item) => sum + item.result.pool.max_total_sampled, 0);
  const totalWaiters = results.reduce((sum, item) => sum + item.result.pool.max_waiting_sampled, 0);
  const telemetryWrites = results.reduce((sum, item) => sum + item.result.performance_sql_telemetry.writes, 0);

  console.log(JSON.stringify({
    target,
    mode: 'independent Node.js processes; one production-configured PostgreSQL pool per process',
    instances,
    profile,
    total_configured_worker_concurrency: perInstanceConcurrency * instances,
    per_instance_concurrency: perInstanceConcurrency,
    measured: {
      requests: measuredRequests,
      elapsed_ms: elapsedMs,
      aggregate_requests_per_second: Number((measuredRequests / Math.max(elapsedMs, 1) * 1000).toFixed(1)),
      failures
    },
    aggregate_pool: {
      configured_max_connections: totalPoolMax,
      max_connections_sampled_sum: totalConnections,
      peak_waiters_sampled_sum: totalWaiters
    },
    performance_sql_telemetry_writes: telemetryWrites,
    instances_results: results.map(({ instance, result }) => ({
      instance,
      measured: result.measured,
      pool: result.pool,
      scenarios: result.scenarios,
      performance_sql_telemetry: result.performance_sql_telemetry
    }))
  }, null, 2));
  if (failures) process.exitCode = 1;
} catch (error) {
  for (const worker of workers) worker.child.kill('SIGTERM');
  console.error(error?.stack || error);
  process.exitCode = 1;
}
