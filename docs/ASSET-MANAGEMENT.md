# CMDB and Asset Management

EffDesk's first CMDB release uses one tenant-scoped **configuration item (CI)** record for both tracked assets and non-physical components. This avoids maintaining separate asset and CI identities: a laptop, application, database, network device or cloud resource can each participate in the same service map.

## Included in this release

- Asset/CI inventory with asset tag, type, lifecycle, criticality, manufacturer, model, serial number, location, owner, purchase date and warranty expiry.
- Optional association to an existing workspace business service.
- Directed CI relationships: depends on, runs on, hosted on, connects to and managed by.
- Links from a CI to existing tickets, problem records and change requests.
- Per-CI activity history.
- Workspace isolation through explicit organization predicates, composite tenant-matched foreign keys and forced row-level security.

## API actions

All actions use the existing authenticated `POST /api/tickets` endpoint and active `orgId`:

- `itsm-ci-list`: `q`, `ciType`, `lifecycle`, `limit`.
- `itsm-ci-get`: `id`.
- `itsm-ci-save`: CI fields and optional `id` for update.
- `itsm-ci-relationship-save`: `sourceCiId`, `targetCiId`, `relationship`.
- `itsm-ci-record-link`: `ciId`, `recordType` (`ticket`, `problem`, `change`), `recordId`.
- `itsm-ci-vendors-list`, `itsm-ci-vendor-save`: vendor inventory and workspace-scoped vendor creation/update.
- `itsm-ci-contracts-list`, `itsm-ci-contract-save`: vendor contract inventory and lifecycle dates.
- `itsm-ci-licenses-list`, `itsm-ci-license-save`: software entitlements, seat counts and renewal dates.
- `itsm-ci-warranty-report`: active assets with warranties due or expired within the requested day window.
- `itsm-ci-import-csv`, `itsm-ci-export-csv`: admin-only asset CSV transfer.
- `itsm-ci-agent-list`, `itsm-ci-agent-create`, `itsm-ci-agent-revoke`: view, enroll and revoke tenant-bound Windows discovery agents; create/revoke are owner/admin-only.

All owner and service references are validated against the current workspace. Cross-workspace references are rejected by both application checks and composite foreign keys.

## Rollout

Apply migrations `048_configuration_items.sql`, `049_cmdb_lifecycle_and_procurement.sql`, `050_cmdb_intune_discovery.sql`, `051_cmdb_windows_discovery_agent.sql` and `052_cmdb_cross_platform_discovery.sql` in order before deploying the application code. These are additive migrations; they do not alter existing ticket, incident, problem, change or service records.

## Procurement and lifecycle extension

Migration `049_cmdb_lifecycle_and_procurement.sql` adds workspace-scoped vendors, contracts and software licenses. Configuration items can be associated with a vendor and contract. License records track publisher, license type, purchased and assigned seats, renewal/end dates, agreement reference and annual cost (never store license keys or secrets here). The Assets & CMDB pane provides supplier, contract, license and warranty-expiry views.

Asset CSV import/export uses `asset_tag` as the stable upsert key. Imports are limited to 500 rows and 400 KB per request; rows without an asset tag/name or with invalid dates are reported as skipped. CSV import and export are owner/admin-only. Export contains inventory fields and does not include user identifiers or internal metadata.

Warranty reporting identifies active assets with expired or upcoming warranties within a selected window (the workspace currently displays the next 90 days). It is a report/alert view, not yet an email escalation scheduler.

## Deliberate next steps

Further CMDB work can expand discovery to macOS/Linux and authorized SNMP/network inventory, improve duplicate-resolution workflows, reconcile discovered applications against purchased license entitlements, add renewal email escalations and provide a richer dependency graph. Discovery credentials must be stored using the platform's tenant-secret encryption mechanism before a live connector is enabled.

## Automated discovery: Microsoft Intune

Migration `050_cmdb_intune_discovery.sql` adds tenant-isolated Intune discovery. Configure the shared EffDesk Entra application as a **multi-tenant** app (accounts in any organizational directory), with the delegated Microsoft Graph `DeviceManagementManagedDevices.Read.All` permission, and set its `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET` on the EffDesk deployment; keep `BETTER_AUTH_SECRET` configured for authenticated encryption. Register this exact redirect URI on the Entra app:

`https://app.effdesk.com/api/integrations/cmdb-discovery/oauth/callback`

For non-production deployments, use that deployment's `APP_URL` plus `/api/integrations/cmdb-discovery/oauth/callback`.

A workspace owner/admin enters the customer's Entra tenant ID or verified tenant domain and completes Microsoft's admin-consent flow. EffDesk requests the delegated `DeviceManagementManagedDevices.Read.All` permission and uses PKCE. Access and refresh tokens are encrypted with the existing application secret and stored per workspace; they are never returned to the browser. The first release reads Intune managed-device inventory only.

Sync is manually initiated from **Assets & CMDB → Procurement & lifecycle → Automated discovery**. It imports at most 2,500 devices per run, links an existing CI by serial number where possible, otherwise creates an Intune-tagged hardware CI, and updates inventory fields plus compliance/OS metadata. Devices not seen in a successful full sync are marked **missing**; EffDesk does not automatically retire or delete them. Disconnecting deletes EffDesk's stored encrypted tokens while retaining discovered CIs. It does not revoke the customer's Entra consent grant; an administrator can revoke that grant from Microsoft Entra separately.

The tenant must grant admin consent for the delegated permission. If consent or the Microsoft app registration is not configured, the integration remains unavailable; CSV import/export and manual asset management continue to work. Scheduled background sync, webhook-driven change notifications, write-back/remediation, and broader Entra user/group discovery are intentionally deferred.


## Automated discovery: customer-installed agents (no Microsoft subscription)

Migrations `051_cmdb_windows_discovery_agent.sql` and `052_cmdb_cross_platform_discovery.sql` add tenant-scoped agent enrollment and installed-software snapshots. This provider does not use Microsoft Entra, Intune, Graph API, or a paid endpoint-management subscription. The customer installs a workspace-enrolled agent on each endpoint; each agent receives a unique, revocable, one-year bearer token. Windows uses the native PowerShell collector. macOS and Linux use the open-source osquery framework plus a small Python 3 bridge. EffDesk stores only a SHA-256 token hash. The token is displayed once when the owner/admin creates the agent and is never returned by list APIs.

In **Assets & CMDB → Procurement & lifecycle → Automated discovery**, create a Windows agent or a macOS/Linux osquery agent and copy its one-time token. For Windows, download `/agents/windows/effdesk-discovery.ps1`. On the target Windows device, open PowerShell and run:

```powershell
.\effdesk-discovery.ps1 -EnrollmentToken "PASTE_ONE_TIME_TOKEN" -InstallScheduledTask -ApiUrl "https://app.effdesk.com/api/cmdb-agent"
```

The Windows script performs read-only local CIM/WMI and uninstall-registry inventory, then sends the snapshot over HTTPS to `/api/cmdb-agent`. It reports hostname, manufacturer, model, BIOS serial, Windows version and up to 500 installed-app name/publisher/version entries. It deliberately does not collect passwords, processes, browser data, documents, IP addresses, or logged-on user details. The optional scheduled-task setup runs every six hours while that Windows user is logged in and protects the saved token with Windows DPAPI for that user. It does not require a Microsoft subscription or an EffDesk Microsoft OAuth app. The agent does not remotely scan other devices; deploy it separately to each endpoint.

The ingestion endpoint binds the bearer token to the encoded workspace ID and a single agent ID, validates the token hash inside that workspace's RLS transaction, and rejects revoked/expired tokens. Hardware is reconciled to an existing manually managed hardware CI by serial number when safe, otherwise a new Windows-agent CI is created. Software snapshots are reconciled per agent; items absent from the latest complete snapshot are marked missing rather than deleted. Owners/admins can revoke an agent at any time. The dashboard shows agent health, last check-in, device details and discovered software.

This first release uses customer-installed endpoint agents, not a network-wide scanner or a centrally managed fleet service. Deploy the appropriate script only to devices the customer owns or is authorized to inventory. Customers should review their own endpoint-management and employee-notice requirements before deployment.


### macOS and Linux with osquery

EffDesk also supports macOS and Linux through [osquery](https://osquery.io/), an open-source operating-system instrumentation framework with native support for Windows, macOS and Linux. The current EffDesk bridge targets macOS and Linux; Windows continues to use the native PowerShell collector. Install the osquery package for the target OS and Python 3.8+, then download `/agents/osquery/effdesk-osquery-discovery.py` from the discovery panel.

Run a one-time check-in with the command generated by EffDesk. For unattended synchronization, store the token in a file readable only by the service account (for example, `chmod 600 /etc/effdesk/enrollment-token`) and schedule the script with cron or the host's normal scheduler:

```sh
python3 effdesk-osquery-discovery.py --token-file /etc/effdesk/enrollment-token --api-url https://app.effdesk.com/api/cmdb-agent
```

The bridge uses osquery's local `system_info`, `os_version`, and platform-appropriate application/package tables. It uses Python's standard library only; no pip packages or paid osquery management service are required. The current release is a pull-style local collector, not a remote osquery TLS fleet manager. Customers should run it on devices they own or are authorized to inventory, and may schedule it at their preferred cadence.

The agent table records the provider and detected platform separately. Hardware and software records are reconciled through the same tenant-bound ingestion path; tokens cannot be used across workspaces or between provider types. The dashboard shows Windows and osquery agents together, with provider labels and last-check-in health.
