import { check, done } from './lib/check.js';
import { buildGrafanaPayload, exportGrafanaSnapshot, grafanaConfig, testGrafanaConnection } from '../src/grafana-otlp.js';

const env = { GRAFANA_OTLP_ENDPOINT: 'https://otlp-gateway-prod-us-west-0.grafana.net/otlp', GRAFANA_CLOUD_INSTANCE_ID: '123456', GRAFANA_CLOUD_API_KEY: 'secret-test-token', CONTEXT: 'test' };
check('Grafana setup requires endpoint, instance id and API key', grafanaConfig(env).configured && !grafanaConfig({}).configured && grafanaConfig({}).missing.length === 3);
check('Grafana endpoint status exposes only the host, never credentials', grafanaConfig(env).host === 'otlp-gateway-prod-us-west-0.grafana.net' && !JSON.stringify(grafanaConfig(env)).includes('secret-test-token'));
let posted = null, postedUrl = '';
const fakeFetch = async (url, options) => { postedUrl = url; posted = JSON.parse(options.body); return { ok: true, status: 200 }; };
const pool = { query: async sql => {
  if (sql.includes('performance_minute')) return { rows: [{ function_name: 'tickets', path: '/api/tickets?secret=hidden', requests: 20, errors: 1, avg_ms: 120, max_ms: 700 }] };
  if (sql.includes('performance_query_minute')) return { rows: [{ query_hash: '0123456789abcdef', operation: 'SELECT', function_name: 'tickets', samples: 4, errors: 0, avg_ms: 80, max_ms: 150 }] };
  if (sql.includes('performance_vitals_minute')) return { rows: [{ metric: 'LCP', page: '/agent/123/tickets', device: 'mobile', samples: 5, avg_value: 2200, max_value: 3900 }] };
  throw new Error('Unexpected query');
} };
const payload = await buildGrafanaPayload(pool, 1760000000000);
const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
check('payload exports API, SQL and browser-vital metric families', metrics.some(x => x.name === 'effdesk_api_requests_24h') && metrics.some(x => x.name === 'effdesk_sql_avg_latency_ms_24h') && metrics.some(x => x.name === 'effdesk_web_vital_avg_24h'));
check('tenant IDs, raw SQL and query strings are not exported', !JSON.stringify(payload).includes('org9') && !JSON.stringify(payload).includes('secret=hidden') && !JSON.stringify(payload).includes('SELECT'));
check('routes are normalized and SQL uses only its fingerprint', JSON.stringify(payload).includes('/api/tickets') && JSON.stringify(payload).includes('0123456789abcdef') && !JSON.stringify(payload).includes('/agent/123/'));
const sent = await exportGrafanaSnapshot(pool, env, fakeFetch);
check('snapshot posts OTLP metrics to the Grafana Cloud v1 metrics endpoint', sent.ok && sent.dataPoints >= 3 && postedUrl === 'https://otlp-gateway-prod-us-west-0.grafana.net/otlp/v1/metrics');
check('OTLP authentication uses the configured instance id and key', postedUrl.startsWith('https://') && !!posted.resourceMetrics);
const tested = await testGrafanaConnection(env, fakeFetch);
check('connection test sends a harmless service-level metric', tested.ok && posted.resourceMetrics[0].scopeMetrics[0].metrics[0].name === 'effdesk_grafana_connection_test');
const bad = await testGrafanaConnection({ ...env, GRAFANA_OTLP_ENDPOINT: 'http://127.0.0.1:3000' }, fakeFetch);
check('non-HTTPS and non-Grafana endpoints are rejected without sending', !bad.ok && bad.configured === false);
done();
