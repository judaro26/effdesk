// src/grafana-otlp.js: opt-in, aggregate-only OTLP export for Grafana Cloud.
import { normalizePath } from './performance.js';

export function grafanaConfig(env = process.env) {
  const endpoint = String(env.GRAFANA_OTLP_ENDPOINT || '').trim();
  const instance = String(env.GRAFANA_CLOUD_INSTANCE_ID || '').trim();
  const token = String(env.GRAFANA_CLOUD_API_KEY || '').trim();
  let host = '';
  try { const u = new URL(endpoint); if (u.protocol === 'https:' && u.hostname.endsWith('.grafana.net') && !u.search && !u.hash) host = u.host; } catch { }
  const configured = !!(host && instance && token);
  return { configured, host: host || null, missing: [!host && 'GRAFANA_OTLP_ENDPOINT (HTTPS Grafana Cloud OTLP URL)', !instance && 'GRAFANA_CLOUD_INSTANCE_ID', !token && 'GRAFANA_CLOUD_API_KEY'].filter(Boolean) };
}

function metric(name, description, points, unit = '1') {
  return { name, description, unit, gauge: { dataPoints: points } };
}
function point(value, attributes, now) {
  return { timeUnixNano: String(BigInt(now) * 1000000n), asDouble: Number(value) || 0, attributes: Object.entries(attributes).map(([key, value]) => ({ key, value: { stringValue: String(value) } })) };
}
function safeEndpoint(env) {
  const u = new URL(String(env.GRAFANA_OTLP_ENDPOINT).trim());
  if (u.protocol !== 'https:' || !u.hostname.endsWith('.grafana.net') || u.search || u.hash) throw new Error('Grafana OTLP endpoint must be an HTTPS Grafana Cloud endpoint without query parameters.');
  const base = u.toString().replace(/\/+$/, '').replace(/\/v1\/metrics$/i, '');
  return base + '/v1/metrics';
}
function authHeader(env) {
  return 'Basic ' + Buffer.from(String(env.GRAFANA_CLOUD_INSTANCE_ID).trim() + ':' + String(env.GRAFANA_CLOUD_API_KEY).trim()).toString('base64');
}

export async function buildGrafanaPayload(pool, now = Date.now()) {
  const [api, sql, vitals] = await Promise.all([
    pool.query("select function_name,path,sum(requests)::int requests,sum(errors)::int errors,round(sum(duration_total_ms)::numeric/greatest(sum(requests),1),2)::float avg_ms,max(duration_max_ms)::int max_ms from performance_minute where minute >= now()-interval '24 hours' group by function_name,path order by sum(requests) desc limit 50"),
    pool.query("select query_hash,operation,function_name,sum(samples)::int samples,sum(errors)::int errors,round(sum(total_ms)::numeric/greatest(sum(samples),1),2)::float avg_ms,max(max_ms)::int max_ms from performance_query_minute where minute >= now()-interval '24 hours' group by query_hash,operation,function_name order by sum(samples) desc limit 50"),
    pool.query("select metric,page,device,sum(samples)::int samples,round(sum(total_value)::numeric/greatest(sum(samples),1),3)::float avg_value,max(max_value)::float max_value from performance_vitals_minute where minute >= now()-interval '24 hours' group by metric,page,device order by sum(samples) desc limit 50")
  ]);
  const ap = api.rows || [], sq = sql.rows || [], vv = vitals.rows || [], metrics = [];
  const add = (name, desc, rows, value, attrs, unit) => {
    const points = rows.map(r => point(r[value], attrs(r), now));
    if (points.length) metrics.push(metric(name, desc, points, unit));
  };
  const apiAttrs = r => ({ function_name: String(r.function_name || 'unknown'), route: normalizePath(r.path) });
  add('effdesk_api_requests_24h', 'Sampled API requests aggregated over the previous 24 hours', ap, 'requests', apiAttrs, '{request}');
  add('effdesk_api_errors_24h', 'Sampled API 5xx responses aggregated over the previous 24 hours', ap, 'errors', apiAttrs, '{error}');
  add('effdesk_api_avg_latency_ms_24h', 'Average sampled API response latency over the previous 24 hours', ap, 'avg_ms', apiAttrs, 'ms');
  add('effdesk_api_max_latency_ms_24h', 'Maximum sampled API response latency over the previous 24 hours', ap, 'max_ms', apiAttrs, 'ms');
  const sqlAttrs = r => ({ operation: String(r.operation || 'OTHER'), function_name: String(r.function_name || 'unknown'), query_fingerprint: String(r.query_hash || '').slice(0, 16) });
  add('effdesk_sql_samples_24h', 'Sampled SQL operations over the previous 24 hours', sq, 'samples', sqlAttrs, '{query}');
  add('effdesk_sql_errors_24h', 'Sampled SQL errors over the previous 24 hours', sq, 'errors', sqlAttrs, '{error}');
  add('effdesk_sql_avg_latency_ms_24h', 'Average sampled SQL query latency over the previous 24 hours', sq, 'avg_ms', sqlAttrs, 'ms');
  add('effdesk_sql_max_latency_ms_24h', 'Maximum sampled SQL query latency over the previous 24 hours', sq, 'max_ms', sqlAttrs, 'ms');
  const vitalAttrs = r => ({ vital: String(r.metric || ''), page: normalizePath(r.page), device: String(r.device || 'unknown') });
  const timedVitals = vv.filter(r => String(r.metric).toUpperCase() !== 'CLS'), clsVitals = vv.filter(r => String(r.metric).toUpperCase() === 'CLS');
  add('effdesk_web_vital_samples_24h', 'Real-user web vital samples over the previous 24 hours', vv, 'samples', vitalAttrs, '{sample}');
  add('effdesk_web_vital_avg_ms_24h', 'Average time-based real-user web vital value over the previous 24 hours', timedVitals, 'avg_value', vitalAttrs, 'ms');
  add('effdesk_web_vital_max_ms_24h', 'Maximum time-based real-user web vital value over the previous 24 hours', timedVitals, 'max_value', vitalAttrs, 'ms');
  add('effdesk_web_vital_avg_cls_24h', 'Average cumulative layout shift over the previous 24 hours', clsVitals, 'avg_value', vitalAttrs, '1');
  add('effdesk_web_vital_max_cls_24h', 'Maximum cumulative layout shift over the previous 24 hours', clsVitals, 'max_value', vitalAttrs, '1');
  return { resourceMetrics: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'effdesk' } }, { key: 'deployment.environment', value: { stringValue: String(process.env.CONTEXT || 'production') } }] }, scopeMetrics: [{ scope: { name: 'effdesk.observability', version: '1.0.0' }, metrics }] }] };
}

async function postMetrics(payload, env, fetcher) {
  const cfg = grafanaConfig(env);
  if (!cfg.configured) return { ok: false, configured: false, missing: cfg.missing };
  let response;
  try {
    response = await fetcher(safeEndpoint(env), { method: 'POST', headers: { Authorization: authHeader(env), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(10000) });
  } catch (e) {
    return { ok: false, configured: true, error: String(e && e.message || 'Network error').slice(0, 180) };
  }
  if (!response.ok) return { ok: false, configured: true, status: response.status, error: 'Grafana Cloud did not accept the OTLP metrics payload.' };
  const metrics = payload.resourceMetrics?.[0]?.scopeMetrics?.[0]?.metrics || [];
  return { ok: true, configured: true, status: response.status, metricSeries: metrics.length, dataPoints: metrics.reduce((n, m) => n + m.gauge.dataPoints.length, 0) };
}

export async function testGrafanaConnection(env = process.env, fetcher = globalThis.fetch) {
  const now = Date.now();
  const payload = { resourceMetrics: [{ resource: { attributes: [{ key: 'service.name', value: { stringValue: 'effdesk' } }] }, scopeMetrics: [{ scope: { name: 'effdesk.connection-test' }, metrics: [metric('effdesk_grafana_connection_test', 'EffDesk Grafana Cloud connection test', [point(1, { source: 'platform_admin' }, now)])] }] }] };
  return postMetrics(payload, env, fetcher);
}
export async function exportGrafanaSnapshot(pool, env = process.env, fetcher = globalThis.fetch) {
  if (!pool) return { ok: false, configured: grafanaConfig(env).configured, error: 'Database is unavailable.' };
  const payload = await buildGrafanaPayload(pool);
  if (!payload.resourceMetrics[0].scopeMetrics[0].metrics.length) return { ok: true, configured: grafanaConfig(env).configured, metricSeries: 0, dataPoints: 0, empty: true };
  return postMetrics(payload, env, fetcher);
}
