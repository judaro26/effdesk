# Problem management

EffDesk Problem Management provides a tenant-scoped record for investigating recurring or high-impact incidents. It deliberately links to existing incident tickets instead of duplicating their conversations.

## Capabilities in this release

- Create and update problem records with title, description, priority (P1–P4), status, owner and known-error flag.
- Record root-cause analysis, temporary workarounds and permanent resolution.
- Link one problem to multiple incident tickets in the same workspace.
- Review linked incident state/severity and a chronological activity history.
- Track problem lifecycle: Open, Investigating, Known error, Resolved and Closed.

## API actions

All actions are sent through the authenticated ticket API and require the workspace's `itsm` entitlement:

- `itsm-problem-list` — list/filter problems.
- `itsm-problem-get` — retrieve a problem, linked incidents and activity.
- `itsm-problem-save` — create/update a problem and replace its linked incident set.

Writes are restricted by the custom-role `itsm` permission. Problem owners must be full workspace members. Linked records must be incident tickets in the same organization.

## Data and isolation

Migration `045_problem_management.sql` creates `problems`, `problem_incidents` and `problem_events`. Every table carries `org_id`, uses forced row-level security and checks the transaction's `app.org_id` setting. Composite foreign keys prevent a problem or incident from being linked across organizations.

## Operational boundaries

This is the initial Problem Management slice. It does not yet include change records, automatic duplicate correlation, known-error article publishing, root-cause templates, SLA clocks for problem records, or automated incident-to-problem suggestions. Problem communications remain internal; customer communication continues through the linked incident tickets.
