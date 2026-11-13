# Incident response provider webhooks

EffDesk can receive incident lifecycle events from PagerDuty, Rootly, and FireHydrant.

## Workspace setup

1. Open **External integrations → Incident response platforms**.
2. Create one endpoint for the provider. Give it a descriptive name.
3. Copy the complete endpoint URL immediately. The random URL token is displayed only once.
4. In the provider's webhook configuration, create a subscription that sends incident lifecycle JSON events to that URL.
5. Send a test event and confirm that the connection's last-event status updates and an incident appears in EffDesk.

The complete URL is a bearer secret. Store it in the provider's protected webhook configuration, do not paste it into tickets or chat, and revoke the endpoint in EffDesk if it is exposed. Revoking immediately disables the token. Create a new endpoint to rotate it.

## Event handling

The receiver accepts JSON POST requests up to 500 KB. It normalizes common incident fields (provider incident ID, title, state, severity, description, external URL, responder, service, and escalation policy) from the provider's event/data/resource shapes.

- A new external incident creates an EffDesk ticket with type **Incident**.
- Acknowledged/assigned/responding events move the EffDesk incident to **Pending**.
- Resolved/closed/cancelled events move it to **Solved**.
- Severity maps to EffDesk P1–P4 and urgent/high/normal/low priority.
- Subsequent events update the same ticket; event IDs are deduplicated.
- External provider URL, status, severity, responder, service, and escalation policy are visible in the EffDesk incident detail panel.
- Every imported incident is scoped to the workspace owning the webhook token.

## Security and current scope

Only SHA-256 digests of endpoint tokens are stored. The small token registry contains only the digest, workspace ID, provider, connection ID, and active flag so the webhook can identify the tenant before tenant row-level security is established. Connection metadata, incident links, and event deduplication records use forced tenant row-level security.

The endpoint URL itself is the authentication secret. This first increment does not yet validate provider-specific HMAC/signature headers, call provider APIs, manage on-call schedules, synchronize escalation policies back to the providers, or import historical incidents. Those capabilities require provider-specific authentication and API adapters and are intentionally not implied by webhook ingestion.
