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

All owner and service references are validated against the current workspace. Cross-workspace references are rejected by both application checks and composite foreign keys.

## Rollout

Apply migrations `048_configuration_items.sql` and `049_cmdb_lifecycle_and_procurement.sql` in order before deploying the application code. Both are additive migrations; they do not alter existing ticket, incident, problem, change or service records.

## Procurement and lifecycle extension

Migration `049_cmdb_lifecycle_and_procurement.sql` adds workspace-scoped vendors, contracts and software licenses. Configuration items can be associated with a vendor and contract. License records track publisher, license type, purchased and assigned seats, renewal/end dates, agreement reference and annual cost (never store license keys or secrets here). The Assets & CMDB pane provides supplier, contract, license and warranty-expiry views.

Asset CSV import/export uses `asset_tag` as the stable upsert key. Imports are limited to 500 rows and 400 KB per request; rows without an asset tag/name or with invalid dates are reported as skipped. CSV import and export are owner/admin-only. Export contains inventory fields and does not include user identifiers or internal metadata.

Warranty reporting identifies active assets with expired or upcoming warranties within a selected window (the workspace currently displays the next 90 days). It is a report/alert view, not yet an email escalation scheduler.

## Deliberate next steps

This is not yet a discovery-grade CMDB. Next work should add reconciliation and duplicate detection, scheduled discovery through tenant-authorized endpoint/RMM/MDM connectors (for example Microsoft Intune via Microsoft Graph), automated license assignment reconciliation, renewal email escalations and a richer dependency graph. Discovery credentials must be stored using the platform's tenant-secret encryption mechanism before a live connector is enabled.
