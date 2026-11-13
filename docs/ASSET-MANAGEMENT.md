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

All owner and service references are validated against the current workspace. Cross-workspace references are rejected by both application checks and composite foreign keys.

## Rollout

Apply migration `048_configuration_items.sql` before deploying the application code. This is an additive migration and does not alter existing ticket, incident, problem, change or service records.

## Deliberate next steps

This is a foundation, not a claim of a complete discovery-grade CMDB. Follow-on work should add bulk CSV import/export, vendor/contract/license records, reconciliation and duplicate detection, scheduled discovery through endpoint/RMM/MDM connectors, richer service dependency visualization, and automatic CI association suggestions.
