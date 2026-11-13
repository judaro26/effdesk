// Optional five-minute aggregate export to Grafana Cloud. Disabled until all three secrets are configured.
import { context } from '../../src/context.js';
import { info, warn } from '../../src/log.js';
import { exportGrafanaSnapshot, grafanaConfig } from '../../src/grafana-otlp.js';

const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export default async function grafanaExport() {
  const env = process.env, cfg = grafanaConfig(env);
  if (!cfg.configured) return response({ skipped: true, reason: 'Grafana Cloud is not configured.' });
  try {
    const { pool } = context();
    const result = await exportGrafanaSnapshot(pool, env);
    if (!result.ok) { warn('grafana_export_failed', { status: result.status, error: result.error }); return response(result, 502); }
    info('grafana_export_completed', { metric_series: result.metricSeries, data_points: result.dataPoints, empty: !!result.empty });
    return response(result);
  } catch (e) {
    warn('grafana_export_failed', { error: String(e && e.message || 'Export failed').slice(0, 180) });
    return response({ ok: false }, 500);
  }
}
export const config = { schedule: '*/5 * * * *' };
