# Change Management

EffDesk Change Management adds a controlled lifecycle for planned, standard, normal and emergency changes. It is tenant-scoped and reuses the existing business-service inventory, incident tickets, custom-role permissions and sequential approval-stage semantics.

## Capabilities in this release

- Change register with lifecycle, risk and impact filters.
- Standard, normal and emergency change types.
- Risk and impact ratings (low, medium, high, critical).
- Planned maintenance start/end windows and an upcoming-window view.
- Change owner, affected business services and related incident links.
- Implementation, validation/test, rollback and post-implementation outcome plans.
- Up to ten sequential approval stages, each using all-approver or any-one policy.
- Tenant-configurable CAB thresholds: minimum stages by change type and minimum approvers per stage by the higher of risk or impact.
- Configurable standard-change pre-approval risk and impact ceilings.
- Maintenance-window conflict detection for overlapping changes that affect the same business service, with warning or blocking enforcement and an optional emergency override.
- Approver notifications, approval decisions, comments and an auditable activity history.
- Controlled lifecycle transitions: draft, submitted, assessing, awaiting approval, approved, scheduled, implementing, completed, failed, cancelled and rejected.

## API actions

All actions require the workspace's `itsm` entitlement:

- `itsm-change-list` — list and filter change requests.
- `itsm-change-get` — retrieve a change, linked services/incidents, decisions and history.
- `itsm-change-save` — create/update change details and linked records.
- `itsm-change-decide` — approve/reject only when the authenticated user is an assigned approver for the active stage.
- `itsm-change-policy-get` / `itsm-change-policy-save` — read or update the workspace CAB policy (owner/admin only for updates).
- `itsm-change-conflicts` — preview overlapping maintenance windows for selected services.

The `itsm` custom-role permission controls change creation and management; the existing `approvals` permission controls approval decisions. Light agents cannot write change records or approve them. Owners and approvers must be full workspace members.

Normal and emergency changes must meet the tenant's configured minimum approval-stage count and minimum approvers per stage. The minimum approver threshold is based on the higher of risk and impact. Standard changes may use the pre-authorized path only within the tenant's configured maximum risk and impact. A change cannot be scheduled without a complete maintenance window, started without implementation and rollback plans, or completed/failed without an outcome. Approval stages are locked while a decision is pending. Resubmitting a rejected request starts a fresh approval round.

## Conflict detection and CAB policy

Conflict detection compares half-open maintenance intervals (start inclusive, end exclusive) for changes that share one or more affected business services. It considers submitted, assessing, awaiting-approval, approved, scheduled and implementing changes, and returns the overlapping change plus the shared service names. Each tenant can choose warning-only behavior or block scheduling until conflicts are resolved. A separate emergency override can be enabled by an owner/admin. Conflict checks and policy reads/writes are always scoped to the active organization.

The CAB policy is stored in `change_cab_policies` with forced row-level security. Owners and admins can configure the number of approval stages required for standard/normal/emergency changes, minimum approvers per stage for low/medium/high/critical risk, and standard-change pre-approval ceilings.

## Tenant isolation

Migrations `046_change_management.sql` and `047_change_cab_policies.sql` create `change_requests`, `change_services`, `change_incidents`, `change_decisions`, `change_events` and `change_approval_notifications`. All tenant-owned tables carry `org_id`, forced row-level security and tenant-matched composite foreign keys for related change, service and ticket records.

## Operational boundaries

This is the initial Change Management slice. It does not yet include a full graphical month/week calendar, recurring blackout calendars, automated risk scoring, change templates, automated deployment integrations, or post-implementation review workflows. Notification delivery is tracked and retryable on a subsequent event, but does not yet have a dedicated scheduled retry worker.
