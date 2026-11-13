# Monitoring alert webhook integrations

EffDesk can ingest alert events from Datadog, Grafana, Splunk, and Sentry. A connection is configured per workspace.

## Setup

1. Open **External integrations → Monitoring alerts**.
2. Generate an endpoint for the provider and copy the complete URL immediately.
3. Configure the provider to POST JSON alert webhooks to that URL.
4. Send a test alert. The endpoint status will show the last delivery, and the alert should appear as an EffDesk incident.
5. Revoke the endpoint in EffDesk if the URL is exposed. Create a new endpoint to rotate it.

The full URL is a bearer secret. It is shown once and only its SHA-256 digest is stored. Do not paste it into tickets, logs, or chat.

## Normalization and deduplication

- **Datadog:** monitor/alert group identity, host/scope, title, alert transition, priority/type, text, and link.
- **Grafana:** each item in `alerts[]` is handled independently; fingerprint is the preferred stable identity, with labels/annotations, status, severity, and generator/dashboard URL.
- **Splunk:** saved-search/alert identity, title, result message, severity, status, and link.
- **Sentry:** issue ID, title, level, action/status, culprit, and permalink.

A new alert creates an EffDesk ticket with type **Incident**. Subsequent events for the same alert identity update that ticket. Repeated delivery events are deduplicated. Firing/triggered alerts are open, acknowledgements move tickets to pending, and recovery/resolution marks them solved. Provider severity is mapped to P1–P4 and EffDesk priority. The linked provider alert and its status/severity are visible in incident details.

## Security and current scope

The endpoint accepts JSON POST requests up to 500 KB. The endpoint URL token is the authentication secret; only its digest is stored. A small global token-hash registry resolves the workspace before RLS context is set. Connection metadata, alert links, and deduplication events are protected by forced tenant row-level security.

This initial increment does not yet validate provider-specific signature headers, call provider APIs, import historical alerts, or manage provider monitor rules. It ingests webhook deliveries only. Use the provider's secure webhook configuration and revoke the endpoint if its URL is disclosed.
