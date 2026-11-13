# Grafana Cloud observability for EffDesk

This integration sends aggregate EffDesk performance metrics to Grafana Cloud using OTLP over HTTPS. It is optional and remains disabled until the three Netlify environment variables below are present.

## 1. Create a Grafana Cloud metrics token

In your Grafana Cloud stack, open **Connections / OpenTelemetry** (the exact navigation label can vary) and copy the OTLP endpoint. Create a service account token/API key with permission to write metrics to the stack's Prometheus/Mimir metrics service. Use the instance ID shown in the stack's Prometheus details.

Do not use an administrator token if a narrower metrics-write token is available.

## 2. Configure Netlify

In the EffDesk Netlify site's environment variables, add:

| Variable | Value |
|---|---|
| `GRAFANA_OTLP_ENDPOINT` | The stack's OTLP base endpoint, typically `https://otlp-gateway-prod-us-west-0.grafana.net/otlp` |
| `GRAFANA_CLOUD_INSTANCE_ID` | The Grafana Cloud metrics instance ID |
| `GRAFANA_CLOUD_API_KEY` | The metrics-write API token |

Use the exact endpoint and region provided by your Grafana Cloud account. Save the variables and redeploy EffDesk. Credentials are read only on the server and are never returned to the browser.

## 3. Verify the connection

Open **Platform Admin → Performance & health**. The Grafana Cloud card shows whether the integration is configured. Select **Test connection** to send a harmless service-level metric. Select **Export snapshot now** to send the current 24-hour aggregate metrics immediately.

A Netlify Scheduled Function also exports every five minutes once configured. When credentials are absent, it exits without sending anything.

## 4. Import the dashboard

In Grafana, open **Dashboards → New → Import**, upload `grafana-effdesk-dashboard.json`, and select the Grafana Cloud Prometheus data source when prompted.

The dashboard charts API request volume, API latency/errors, SQL query volume/latency and time-based real-user Web Vitals. CLS is exported separately as a unitless score.

## Data and privacy

- Exports are aggregate rolling 24-hour snapshots, refreshed every five minutes.
- The API and SQL series are grouped by function/normalized route or operation/function/query fingerprint.
- Browser vitals are grouped by metric, normalized page route and device.
- Tenant IDs, user IDs, raw SQL, SQL parameters, ticket/requester content, email addresses and query strings are not exported.
- The dashboard's metrics are gauges representing rolling aggregates, not per-request traces or raw event streams.
- EffDesk's native Performance & health console remains available independently of Grafana.

## Troubleshooting

- **Not configured:** confirm all three environment variables are set for the production Netlify context and redeploy.
- **401/403:** verify the instance ID matches the stack and the token has metrics-write permission.
- **404:** verify the OTLP endpoint and region from the Grafana Cloud stack. The integration appends `/v1/metrics` to the configured OTLP base endpoint.
- **No charts yet:** first generate EffDesk traffic after PR #84 is deployed so the native aggregate tables have data; then allow a scheduled export or use **Export snapshot now**.