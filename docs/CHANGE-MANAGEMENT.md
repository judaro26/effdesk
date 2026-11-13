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
- Approver notifications, approval decisions, comments and an auditable activity history.
- Controlled lifecycle transitions: draft, submitted, assessing, awaiting approval, approved, scheduled, implementing, completed, failed, cancelled and rejected.

## API actions

All actions require the workspace's `itsm` entitlement:

- `itsm-change-list` — list and filter change requests.
- `itsm-change-get` — retrieve a change, linked services/incidents, decisions and history.
- `itsm-change-save` — create/update change details and linked records.
- `itsm-change-decide` — approve/reject only when the authenticated user is an assigned approver for the active stage.

The `itsm` custom-role permission controls change creation and management; the existing `approvals` permission controls approval decisions. Light agents cannot write change records or approve them. Owners and approvers must be full workspace members.

Normal and emergency changes must complete configured approval stages before approval. Standard changes may be approved by an authorized change manager as pre-authorized low-risk procedures. A change cannot be scheduled without a complete maintenance window, started without implementation and rollback plans, or completed/failed without an outcome. Approval stages are locked while a decision is pending. Resubmitting a rejected request starts a fresh approval round.

## Tenant isolation

Migration `046_change_management.sql` creates `change_requests`, `change_services`, `change_incidents`, `change_decisions`, `change_events` and `change_approval_notifications`. All tenant-owned tables carry `org_id`, forced row-level security and tenant-matched composite foreign keys for related change, service and ticket records.

## Operational boundaries

This is the initial Change Management slice. It does not yet include a full graphical month/week calendar, configurable CAB quorum/blackout rules, automated conflict detection, risk scoring, maintenance-window collision warnings, change templates, automated deployment integrations, or post-implementation review workflows. Notification delivery is tracked and retryable on a subsequent event, but does not yet have a dedicated scheduled retry worker.
