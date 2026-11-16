# Tenant RLS coverage and documented exceptions

EffDesk uses forced PostgreSQL row-level security for tenant-owned operational tables. Run `npm run audit:tenant-rls` against the target database to inventory every public table with an `org_id` column.

The audit distinguishes three outcomes:

- **Protected:** RLS is enabled and forced, with tenant-aware `USING` and `WITH CHECK` policies.
- **Documented exception:** the table intentionally participates in a server-only cross-tenant lookup or platform control-plane workflow before a tenant context exists. The audit prints the reason and does not count it as protected.
- **Unapproved gap:** a table is neither protected nor explicitly documented. The audit exits nonzero.

## Current exceptions

| Table | Reason it is not tenant-RLS protected |
|---|---|
| `inbox_directory` | Inbound email routing must resolve the organization from the inbox address before tenant context exists; it stores only the routing mapping. |
| `email_receipts` | Resend callbacks resolve the organization from a provider message ID before tenant context; no message content is stored. |
| `incident_provider_token_registry` | A hash-only webhook token resolves the tenant before context; operational connection data is forced-RLS. |
| `monitoring_alert_token_registry` | A hash-only monitoring token resolves the tenant before context; operational connection data is forced-RLS. |
| `project_oauth_states` | Short-lived OAuth state hashes resolve the tenant during provider callbacks. |
| `scim_tokens` | A hash-only SCIM bearer token resolves the tenant before tenant-scoped SCIM operations. |
| `sso_providers` | SSO discovers the tenant by email domain before authentication and tenant context; client secrets are encrypted and server-only. |
| `whatsapp_accounts` | Meta verification and inbound webhooks resolve the tenant by phone-number ID or verification token; credentials are encrypted. |
| `subscriptions` | Platform billing and Paddle callbacks resolve subscription records across organizations. |
| `support_access` | Platform-owner support grants are control-plane records. |
| `org_overrides` | Entitlement and suspension overrides are platform-owner control-plane records. |
| `usage_daily` | Platform usage rollups are generated and read by platform-owner operations. |
| `usage_alerts` | Platform usage alert deduplication is managed by cross-organization platform jobs. |
| `error_events` | Platform-wide operational telemetry is written by server instrumentation and read by platform administrators. |
| `performance_minute` | Sampled platform request-performance aggregates. |
| `performance_query_minute` | Sampled SQL performance aggregates. |
| `performance_vitals_minute` | Aggregated real-user performance vitals without user identifiers or page content. |
| `status_components` | Public status content supports platform and workspace pages; the status API filters by workspace or platform null scope. |
| `status_incidents` | Public incident and maintenance timelines support platform and workspace pages; the status API filters by workspace or platform null scope. |

These exceptions are not equivalent to tenant-RLS protection. They rely on narrowly scoped server-side resolver/control-plane paths and must never be exposed through general tenant CRUD APIs. Token registries contain hashes, not raw bearer secrets. Operational tables related to incident and monitoring integrations remain forced-RLS.

## Adding a new table

Do not add a table to the exception list merely to make CI pass. First decide whether it is tenant-owned data or a genuine pre-tenant resolver/platform table. Prefer a tenant-RLS policy whenever the organization is already known. If a global resolver is unavoidable, keep its contents minimal (opaque hashes or routing keys), document the callback that needs it, and keep the corresponding operational data in a separate forced-RLS table.
