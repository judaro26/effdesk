// src/performance.js: sampled, privacy-conscious request performance aggregates for the platform owner.
const clampRate = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.1; };
export function normalizePath(path) {
  return String(path || '/').split('?')[0].replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/(\d+)(?=\/|$)/g, '/:id').slice(0, 180) || '/';
}
export async function recordRequest(pool, sample, env = process.env, random = Math.random) {
  const rate = clampRate(env.PERFORMANCE_SAMPLE_RATE == null ? 0.1 : env.PERFORMANCE_SAMPLE_RATE);
  if (!pool || rate === 0 || random() >= rate) return { recorded: false, sampled: false };
  const ms = Math.max(0, Math.min(2147483647, Math.round(Number(sample.ms) || 0)));
  const bucket = ms < 100 ? 0 : ms < 500 ? 1 : ms < 1000 ? 2 : 3;
  const minute = new Date(Math.floor((Number(sample.at) || Date.now()) / 60000) * 60000).toISOString();
  const org = String(sample.org || '').slice(0, 80), fn = String(sample.fn || 'unknown').slice(0, 60), path = normalizePath(sample.path), status = Number(sample.status) || 0, poolStats = sample.pool || {};
  try {
    await pool.query('insert into performance_minute (minute,function_name,path,org_id,requests,errors,slow_requests,duration_total_ms,duration_max_ms,bucket_lt100,bucket_100to499,bucket_500to999,bucket_gte1000,pool_waiting_max,pool_total_max) values ($1,$2,$3,$4,1,$5,$6,$7,$7,$8,$9,$10,$11,$12,$13) on conflict (minute,function_name,path,org_id) do update set requests=performance_minute.requests+1,errors=performance_minute.errors+excluded.errors,slow_requests=performance_minute.slow_requests+excluded.slow_requests,duration_total_ms=performance_minute.duration_total_ms+excluded.duration_total_ms,duration_max_ms=greatest(performance_minute.duration_max_ms,excluded.duration_max_ms),bucket_lt100=performance_minute.bucket_lt100+excluded.bucket_lt100,bucket_100to499=performance_minute.bucket_100to499+excluded.bucket_100to499,bucket_500to999=performance_minute.bucket_500to999+excluded.bucket_500to999,bucket_gte1000=performance_minute.bucket_gte1000+excluded.bucket_gte1000,pool_waiting_max=greatest(performance_minute.pool_waiting_max,excluded.pool_waiting_max),pool_total_max=greatest(performance_minute.pool_total_max,excluded.pool_total_max)',
      [minute, fn, path, org, status >= 500 ? 1 : 0, ms >= 1000 ? 1 : 0, ms, bucket === 0 ? 1 : 0, bucket === 1 ? 1 : 0, bucket === 2 ? 1 : 0, bucket === 3 ? 1 : 0, Math.max(0, Number(poolStats.waiting) || 0), Math.max(0, Number(poolStats.total) || 0)]);
    if (random() < 0.002) await pool.query("delete from performance_minute where minute < now() - interval '14 days'").catch(() => null);
    return { recorded: true, sampled: true };
  } catch { return { recorded: false, sampled: true }; }
}
const p95Bucket = r => {
  const n = Number(r.requests) || 0; if (!n) return null;
  const target = Math.ceil(n * 0.95); let c = Number(r.bucket_lt100) || 0;
  if (c >= target) return '<100 ms';
  c += Number(r.bucket_100to499) || 0; if (c >= target) return '100–499 ms';
  c += Number(r.bucket_500to999) || 0; if (c >= target) return '500–999 ms';
  return '≥1,000 ms';
};
const decorate = r => ({ ...r, avg_ms: Number(r.requests) ? Math.round(Number(r.duration_total_ms) / Number(r.requests)) : 0, p95_bucket: p95Bucket(r), error_rate: Number(r.requests) ? Number((Number(r.errors) / Number(r.requests) * 100).toFixed(2)) : 0 });
export async function performanceOverview(pool, range = '24h') {
  const hours = range === '1h' ? 1 : 24;
  const [summary, series, routes, tenants] = await Promise.all([
    pool.query('select coalesce(sum(requests),0)::int requests,coalesce(sum(errors),0)::int errors,coalesce(sum(slow_requests),0)::int slow_requests,coalesce(sum(duration_total_ms),0)::bigint duration_total_ms,coalesce(max(duration_max_ms),0)::int max_ms,coalesce(sum(bucket_lt100),0)::int bucket_lt100,coalesce(sum(bucket_100to499),0)::int bucket_100to499,coalesce(sum(bucket_500to999),0)::int bucket_500to999,coalesce(sum(bucket_gte1000),0)::int bucket_gte1000,coalesce(max(pool_waiting_max),0)::int pool_waiting_max,coalesce(max(pool_total_max),0)::int pool_total_max from performance_minute where minute >= now() - ($1::int * interval \'1 hour\')', [hours]),
    pool.query("select to_char(date_trunc('hour',minute),'YYYY-MM-DD\"T\"HH24:00:00\"Z\"') hour,sum(requests)::int requests,sum(errors)::int errors,round(sum(duration_total_ms)::numeric/greatest(sum(requests),1))::int avg_ms from performance_minute where minute >= now() - ($1::int * interval '1 hour') group by date_trunc('hour',minute) order by date_trunc('hour',minute)", [hours]),
    pool.query("select function_name,path,sum(requests)::int requests,sum(errors)::int errors,sum(slow_requests)::int slow_requests,sum(duration_total_ms)::bigint duration_total_ms,max(duration_max_ms)::int max_ms,sum(bucket_lt100)::int bucket_lt100,sum(bucket_100to499)::int bucket_100to499,sum(bucket_500to999)::int bucket_500to999,sum(bucket_gte1000)::int bucket_gte1000 from performance_minute where minute >= now()-interval '24 hours' group by function_name,path order by sum(duration_total_ms)::numeric/greatest(sum(requests),1) desc limit 12"),
    pool.query("select org_id,sum(requests)::int requests,sum(errors)::int errors,sum(duration_total_ms)::bigint duration_total_ms,max(duration_max_ms)::int max_ms from performance_minute where minute >= now()-interval '24 hours' and org_id <> '' group by org_id order by sum(duration_total_ms)::numeric/greatest(sum(requests),1) desc limit 10")
  ]);
  const s = decorate(summary.rows[0] || {}), routesOut = routes.rows.map(decorate), tenantsOut = tenants.rows.map(decorate), diagnostics = [];
  if (!s.requests) diagnostics.push({ severity: 'info', title: 'Collecting baseline', detail: 'No sampled requests are available for this period yet. Keep the console open after deploying the instrumentation to build a baseline.' });
  else {
    if (s.p95_bucket === '≥1,000 ms') diagnostics.push({ severity: 'warning', title: 'Slow request tail', detail: 'At least 5% of sampled requests took 1 second or longer. Inspect the slowest endpoints below.' });
    if (s.error_rate >= 2 && s.requests >= 50) diagnostics.push({ severity: 'critical', title: 'Elevated server error rate', detail: 'At least 2% of sampled requests returned HTTP 5xx responses.' });
    if (s.pool_waiting_max > 0) diagnostics.push({ severity: 'warning', title: 'Database pool contention observed', detail: 'At least one sample observed clients waiting for a database connection.' });
    if (s.slow_requests > 0 && s.p95_bucket !== '≥1,000 ms') diagnostics.push({ severity: 'info', title: 'Slow requests detected', detail: s.slow_requests + ' sampled requests took at least 1 second.' });
    if (!diagnostics.length) diagnostics.push({ severity: 'success', title: 'No threshold breaches detected', detail: 'The collected sample is within the current built-in thresholds. This is not a guarantee that every request was healthy.' });
  }
  return { ok: true, range: hours + 'h', sampleRate: clampRate(process.env.PERFORMANCE_SAMPLE_RATE == null ? 0.1 : process.env.PERFORMANCE_SAMPLE_RATE), summary: s, series: series.rows, routes: routesOut, tenants: tenantsOut, diagnostics, retentionDays: 14, notes: ['Request metrics are sampled and aggregated; p95 is shown as a latency band, not an exact percentile.', 'Database pool waiting is observed at request completion; individual SQL query timings are not yet instrumented.', 'Browser Core Web Vitals and external provider CPU/memory metrics are not yet included.'] };
}
