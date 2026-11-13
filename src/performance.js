// src/performance.js: sampled, privacy-conscious request performance aggregates for the platform owner.
import crypto from 'node:crypto';
const clampRate = value => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.1; };
export function normalizePath(path) {
  return String(path || '/').split('?')[0].replace(/\/(w|workspace|portal)\/[^/]+/gi, '/$1/:tenant').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id').replace(/\/(\d+)(?=\/|$)/g, '/:id').slice(0, 180) || '/';
}

const sqlText = value => typeof value === 'string' ? value : value && typeof value.text === 'string' ? value.text : '';
export function normalizeSql(sql) {
  return String(sql || '').replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:''|[^'])*'/g, '?').replace(/\$\d+/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim().slice(0, 12000);
}
export async function recordSqlQuery(pool, sample, env = process.env, random = Math.random) {
  const rate = clampRate(env.PERFORMANCE_SQL_SAMPLE_RATE == null ? 0.03 : env.PERFORMANCE_SQL_SAMPLE_RATE);
  const sql = sqlText(sample.sql);
  if (!pool || !sql || rate === 0 || random() >= rate || /performance_(?:minute|query_minute|vitals_minute)/i.test(sql) || /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i.test(sql)) return { recorded: false };
  const normalized = normalizeSql(sql); if (!normalized) return { recorded: false };
  const fingerprint = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
  const operation = (normalized.match(/^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER|DROP|SET|SHOW)/i) || ['OTHER'])[0].toUpperCase();
  const ms = Math.max(0, Math.min(2147483647, Math.round(Number(sample.ms) || 0)));
  const bucket = ms < 25 ? 0 : ms < 100 ? 1 : ms < 500 ? 2 : 3;
  const minute = new Date(Math.floor((Number(sample.at) || Date.now()) / 60000) * 60000).toISOString();
  try {
    await pool.query('insert into performance_query_minute (minute,query_hash,operation,function_name,org_id,samples,errors,total_ms,max_ms,bucket_lt25,bucket_25to99,bucket_100to499,bucket_gte500) values ($1,$2,$3,$4,$5,1,$6,$7,$7,$8,$9,$10,$11) on conflict (minute,query_hash,operation,function_name,org_id) do update set samples=performance_query_minute.samples+1,errors=performance_query_minute.errors+excluded.errors,total_ms=performance_query_minute.total_ms+excluded.total_ms,max_ms=greatest(performance_query_minute.max_ms,excluded.max_ms),bucket_lt25=performance_query_minute.bucket_lt25+excluded.bucket_lt25,bucket_25to99=performance_query_minute.bucket_25to99+excluded.bucket_25to99,bucket_100to499=performance_query_minute.bucket_100to499+excluded.bucket_100to499,bucket_gte500=performance_query_minute.bucket_gte500+excluded.bucket_gte500',
      [minute,fingerprint,operation,String(sample.fn||'unknown').slice(0,60),String(sample.org||'').slice(0,80),sample.error?1:0,ms,bucket===0?1:0,bucket===1?1:0,bucket===2?1:0,bucket===3?1:0]);
    return { recorded: true, fingerprint };
  } catch { return { recorded: false }; }
}
const vitalThresholds = { LCP:[2500,4000], INP:[200,500], CLS:[0.1,0.25], TTFB:[800,1800], FCP:[1800,3000] };
export function vitalRating(name, value) {
  const t=vitalThresholds[name]; if(!t) return null;
  return Number(value)<=t[0]?'good':Number(value)<=t[1]?'needs_improvement':'poor';
}
export async function recordWebVital(pool, sample) {
  const name=String(sample.name||'').toUpperCase(), value=Number(sample.value), rating=vitalRating(name,value);
  if(!pool||!rating||!Number.isFinite(value)||value<0||value>60000) return {recorded:false};
  const org=String(sample.org||'').slice(0,80), page=normalizePath(sample.page), device=['mobile','tablet','desktop'].includes(sample.device)?sample.device:'unknown';
  const minute=new Date(Math.floor((Number(sample.at)||Date.now())/60000)*60000).toISOString();
  try {
    await pool.query('insert into performance_vitals_minute (minute,org_id,page,device,metric,samples,total_value,max_value,good_count,needs_improvement_count,poor_count) values ($1,$2,$3,$4,$5,1,$6,$6,$7,$8,$9) on conflict (minute,org_id,page,device,metric) do update set samples=performance_vitals_minute.samples+1,total_value=performance_vitals_minute.total_value+excluded.total_value,max_value=greatest(performance_vitals_minute.max_value,excluded.max_value),good_count=performance_vitals_minute.good_count+excluded.good_count,needs_improvement_count=performance_vitals_minute.needs_improvement_count+excluded.needs_improvement_count,poor_count=performance_vitals_minute.poor_count+excluded.poor_count',
    [minute,org,page,device,name,value,rating==='good'?1:0,rating==='needs_improvement'?1:0,rating==='poor'?1:0]);
    return {recorded:true,rating};
  } catch { return {recorded:false}; }
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
    if (random() < 0.001) void Promise.all(['performance_minute','performance_query_minute','performance_vitals_minute'].map(t => pool.query('delete from ' + t + " where minute < now() - interval '14 days'").catch(() => null)));
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
export async function performanceOverview(pool, range = '24h', env = process.env) {
  const schema = await pool.query("select to_regclass('public.performance_minute') as request_table, to_regclass('public.performance_query_minute') as sql_table, to_regclass('public.performance_vitals_minute') as vitals_table");
  const schemaRow = schema.rows && schema.rows[0] || {};
  const missingTables = [['performance_minute', schemaRow.request_table], ['performance_query_minute', schemaRow.sql_table], ['performance_vitals_minute', schemaRow.vitals_table]].filter(([, value]) => !value).map(([name]) => name);
  if (missingTables.length) return {
    ok: true, schemaReady: false, missingTables, range: range === '1h' ? '1h' : '24h',
    sampleRate: clampRate(env.PERFORMANCE_SAMPLE_RATE == null ? 0.1 : env.PERFORMANCE_SAMPLE_RATE),
    sqlSampleRate: clampRate(env.PERFORMANCE_SQL_SAMPLE_RATE == null ? 0.03 : env.PERFORMANCE_SQL_SAMPLE_RATE),
    summary: { requests: 0, errors: 0, slow_requests: 0, avg_ms: 0, p95_bucket: null, error_rate: 0, pool_waiting_max: 0 },
    series: [], routes: [], tenants: [], sqlQueries: [], vitals: [],
    diagnostics: [{ severity: 'warning', title: 'Performance database migrations are incomplete', detail: 'The performance telemetry tables are not all present in the production database.' }],
    retentionDays: 14,
    notes: ['Missing tables: ' + missingTables.join(', '), 'Deploy the latest production build so the migration runner can apply the performance telemetry migrations.']
  };
  const hours = range === '1h' ? 1 : 24;
  const [summary, series, routes, tenants, sqlQueries, vitals] = await Promise.all([
    pool.query('select coalesce(sum(requests),0)::int requests,coalesce(sum(errors),0)::int errors,coalesce(sum(slow_requests),0)::int slow_requests,coalesce(sum(duration_total_ms),0)::bigint duration_total_ms,coalesce(max(duration_max_ms),0)::int max_ms,coalesce(sum(bucket_lt100),0)::int bucket_lt100,coalesce(sum(bucket_100to499),0)::int bucket_100to499,coalesce(sum(bucket_500to999),0)::int bucket_500to999,coalesce(sum(bucket_gte1000),0)::int bucket_gte1000,coalesce(max(pool_waiting_max),0)::int pool_waiting_max,coalesce(max(pool_total_max),0)::int pool_total_max from performance_minute where minute >= now() - ($1::int * interval \'1 hour\')', [hours]),
    pool.query("select to_char(date_trunc('hour',minute AT TIME ZONE 'UTC'),'YYYY-MM-DD\"T\"HH24:00:00\"Z\"') hour,sum(requests)::int requests,sum(errors)::int errors,round(sum(duration_total_ms)::numeric/greatest(sum(requests),1))::int avg_ms from performance_minute where minute >= now() - ($1::int * interval '1 hour') group by date_trunc('hour',minute AT TIME ZONE 'UTC') order by date_trunc('hour',minute AT TIME ZONE 'UTC')", [hours]),
    pool.query("select function_name,path,sum(requests)::int requests,sum(errors)::int errors,sum(slow_requests)::int slow_requests,sum(duration_total_ms)::bigint duration_total_ms,max(duration_max_ms)::int max_ms,sum(bucket_lt100)::int bucket_lt100,sum(bucket_100to499)::int bucket_100to499,sum(bucket_500to999)::int bucket_500to999,sum(bucket_gte1000)::int bucket_gte1000 from performance_minute where minute >= now()-interval '24 hours' group by function_name,path order by sum(duration_total_ms)::numeric/greatest(sum(requests),1) desc limit 12"),
    pool.query("select org_id,sum(requests)::int requests,sum(errors)::int errors,sum(duration_total_ms)::bigint duration_total_ms,max(duration_max_ms)::int max_ms from performance_minute where minute >= now()-interval '24 hours' and org_id <> '' group by org_id order by sum(duration_total_ms)::numeric/greatest(sum(requests),1) desc limit 10"),
    pool.query("select query_hash,operation,function_name,sum(samples)::int samples,sum(errors)::int errors,sum(total_ms)::bigint total_ms,max(max_ms)::int max_ms,sum(bucket_lt25)::int bucket_lt25,sum(bucket_25to99)::int bucket_25to99,sum(bucket_100to499)::int bucket_100to499,sum(bucket_gte500)::int bucket_gte500 from performance_query_minute where minute >= now()-interval '24 hours' group by query_hash,operation,function_name order by sum(total_ms)::numeric/greatest(sum(samples),1) desc limit 12"),
    pool.query("select metric,page,device,sum(samples)::int samples,round(sum(total_value)::numeric/greatest(sum(samples),1),2)::float avg_value,max(max_value)::float max_value,sum(good_count)::int good_count,sum(needs_improvement_count)::int needs_improvement_count,sum(poor_count)::int poor_count from performance_vitals_minute where minute >= now()-interval '24 hours' group by metric,page,device order by metric,page limit 30")
  ]);
  const s = decorate(summary.rows[0] || {}), routesOut = routes.rows.map(decorate), tenantsOut = tenants.rows.map(decorate), sqlOut = sqlQueries.rows.map(r => ({ ...r, avg_ms: Number(r.samples) ? Math.round(Number(r.total_ms) / Number(r.samples)) : 0, p95_bucket: (() => { const target = Math.ceil(Number(r.samples) * .95); let n = Number(r.bucket_lt25) || 0; if (n >= target) return '<25 ms'; n += Number(r.bucket_25to99) || 0; if (n >= target) return '25–99 ms'; n += Number(r.bucket_100to499) || 0; if (n >= target) return '100–499 ms'; return '≥500 ms'; })() })), vitalsOut = vitals.rows.map(r => { const target = Math.ceil(Number(r.samples) * .75), good = Number(r.good_count) || 0, needs = Number(r.needs_improvement_count) || 0; return { ...r, p75_rating: good >= target ? 'good' : good + needs >= target ? 'needs improvement' : 'poor' }; }), diagnostics = [];
  if (!s.requests) diagnostics.push({ severity: 'info', title: 'Collecting baseline', detail: 'No sampled requests are available for this period yet. Keep the console open after deploying the instrumentation to build a baseline.' });
  else {
    if (s.p95_bucket === '≥1,000 ms') diagnostics.push({ severity: 'warning', title: 'Slow request tail', detail: 'At least 5% of sampled requests took 1 second or longer. Inspect the slowest endpoints below.' });
    if (s.error_rate >= 2 && s.requests >= 50) diagnostics.push({ severity: 'critical', title: 'Elevated server error rate', detail: 'At least 2% of sampled requests returned HTTP 5xx responses.' });
    if (s.pool_waiting_max > 0) diagnostics.push({ severity: 'warning', title: 'Database pool contention observed', detail: 'At least one sample observed clients waiting for a database connection.' });
    if (s.slow_requests > 0 && s.p95_bucket !== '≥1,000 ms') diagnostics.push({ severity: 'info', title: 'Slow requests detected', detail: s.slow_requests + ' sampled requests took at least 1 second.' });
  }
  if (sqlOut.some(x => x.p95_bucket === '≥500 ms')) diagnostics.push({ severity: 'warning', title: 'Slow database queries detected', detail: 'At least one sampled SQL fingerprint has a p95 latency band of 500 ms or longer.' });
  if (vitalsOut.some(x => x.p75_rating === 'poor')) diagnostics.push({ severity: 'warning', title: 'Poor real-user experience detected', detail: 'At least one page/device Core Web Vital has a poor p75 rating. Compare page and device groups below.' });
  else if (vitalsOut.some(x => x.p75_rating === 'needs improvement')) diagnostics.push({ severity: 'info', title: 'Core Web Vitals need improvement', detail: 'At least one page/device group is above the good p75 threshold.' });
  if (s.requests && !diagnostics.length) diagnostics.push({ severity: 'success', title: 'No threshold breaches detected', detail: 'The collected sample is within the current built-in thresholds. This is not a guarantee that every request was healthy.' });
  return { ok: true, range: hours + 'h', sqlSampleRate: clampRate(env.PERFORMANCE_SQL_SAMPLE_RATE == null ? 0.03 : env.PERFORMANCE_SQL_SAMPLE_RATE), sqlQueries: sqlOut, vitals: vitalsOut, sampleRate: clampRate(env.PERFORMANCE_SAMPLE_RATE == null ? 0.1 : env.PERFORMANCE_SAMPLE_RATE), summary: s, series: series.rows, routes: routesOut, tenants: tenantsOut, diagnostics, retentionDays: 14, notes: ['Request metrics are sampled and aggregated; p95 is shown as a latency band, not an exact percentile.', 'SQL timings and browser vitals are sampled; raw SQL, parameters and browser content are not stored.', 'Browser vitals sample 20% of agent-desk page views and do not yet cover the public help center or requester portal.'] };
}
