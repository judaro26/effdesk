# EffDesk Product Master Plan

**Status:** Product strategy and implementation blueprint  
**Audience:** Product, engineering, design, operations  
**Scope:** Shared multi-tenant EffDesk deployment

## 1. Product direction

Position EffDesk as an **AI-native service operations platform** for organizations that want the practical capabilities of enterprise service management without the implementation burden, complexity, or pricing of legacy suites.

EffDesk should not attempt to reproduce every screen in ServiceNow, Zendesk, or Freshdesk. It should win on:

1. A fast, approachable agent and requester experience.
2. One extensible workflow engine across support, IT, and business operations.
3. AI that can safely take actions, not only draft text.
4. Useful customer, employee, service, and asset context in one workspace.
5. Predictable modular packaging for small teams through enterprise customers.

### Product principles

- **Tenant isolation is foundational.** Every tenant-owned record, credential, job, webhook, AI context, and integration must be scoped to the organization. Database RLS remains a second line of defense, not a substitute for explicit query scoping.
- **Configuration before customization.** Prefer configurable forms, fields, workflows, roles, and templates over tenant-specific code.
- **Human control for consequential actions.** Destructive, financial, security-sensitive, or externally visible actions require explicit policy and, where configured, approval.
- **One source of truth.** Tickets, contacts, companies, assets, service requests, incidents, and external work items should be related records rather than duplicated silos.
- **Composable capabilities.** Features are enabled by plan entitlements and organization-level overrides; navigation and APIs must respect the same entitlements.
- **Incremental delivery.** Each phase must be deployable, testable, and useful without requiring later phases.

## 2. Existing product foundation

The repository already contains substantial functionality. Build on it rather than recreate it.

| Area | Existing foundation |
|---|---|
| Multi-tenancy and identity | Better Auth organizations, memberships, tenant-scoped Postgres access and RLS |
| Service desk | Tickets, messages, queues, labels, macros, saved views, filters, custom statuses |
| Service levels | SLA policies, business hours, alerts and reporting |
| Customer management | Clients/companies, contact profiles, requester history |
| Customer experience | Help center, portal, request forms, live chat, WhatsApp |
| Workflow | Triggers, automations, routing, custom fields, request forms |
| AI | Existing reply assistance, summarize/rewrite and usage controls |
| Integrations | Webhooks, API tokens, Linear/Jira issue links and synchronization |
| Governance | Roles, audit log, SSO, platform-level plan and feature overrides |

Before adding a capability, inspect the current implementation, migrations, tests, entitlements, and navigation. Some roadmap items already exist in code and may only need completion or hardening.

## 3. Product pillars and target capabilities

### Pillar A — Customer and employee service desk

**Goal:** Make it effortless to ask for help and easy for teams to resolve requests.

Capabilities:
- Unified requester profiles and company/account records.
- Configurable service catalog built on the existing request-form foundation.
- Conditional form fields, validation, attachments, request-specific instructions and confirmation.
- Request lifecycle, approvals, watchers, tasks and due dates.
- Customer portal with request history, status, knowledge suggestions and service updates.
- Knowledge base with categories, article lifecycle, feedback and AI-assisted article creation.
- Omnichannel conversation continuity across email, portal, chat and WhatsApp; add channels only when support operations can maintain them.

### Pillar B — Workflow and automation platform

**Goal:** Let administrators model repeatable work without writing code.

Capabilities:
- Visual workflow builder with triggers, conditions, branches, waits, approvals and actions.
- Reusable actions for ticket updates, assignment, notifications, HTTP/webhook calls and supported integrations.
- Versioned workflow definitions and safe publish/rollback.
- Execution history, idempotency, retry policy, dead-letter/error visibility and replay controls.
- Test/dry-run mode and clear permission boundaries.
- Templates for onboarding, access requests, procurement, incident response and customer onboarding.

**Architecture direction:** Evolve the existing trigger engine in place where safe. Introduce a durable execution model for multi-step workflows rather than stretching synchronous ticket triggers into a general-purpose workflow runtime.

### Pillar C — AI-native service operations

**Goal:** Move from AI assistance to supervised AI execution.

Capabilities:
- Agent copilot: summarize, classify, draft, translate, detect sentiment and recommend next actions.
- Grounded knowledge retrieval from authorized articles, ticket history and tenant-approved documents.
- AI routing and duplicate/related-ticket detection.
- Agent builder with explicit tools, scopes, allowed actions, approval thresholds and budgets.
- Human handoff, confidence thresholds, full action trace and evaluation.
- AI quality review and coaching, with transparent criteria and appeal/review controls.
- Natural-language analytics and automation authoring, with a reviewable structured result before activation.

**Safety and privacy requirements:**
- Never mix tenant retrieval indexes, prompts, files, or tool credentials.
- Apply the acting user's permissions to every tool call.
- Keep secrets out of model context and logs.
- Require approval for sensitive or irreversible actions.
- Record model, policy, inputs/references, tool calls, outcomes, and human overrides.
- Provide tenant-level retention, opt-out, usage limits, and cost controls.
- Treat ticket content and retrieved documents as untrusted input, never as system instructions.

### Pillar D — IT service management

**Goal:** Expand from help desk to practical ITSM without importing unnecessary legacy complexity.

Capabilities, in order:
1. Major incident management and incident communications.
2. Problem records and known-error knowledge, with links to incidents and changes.
3. Change requests with risk, impact, schedule, approvals and implementation/rollback plans.
4. Service catalog and request fulfillment.
5. On-call rotations and escalation policies.
6. Asset inventory and lifecycle management.
7. CMDB/service map connecting services, applications, infrastructure, owners, vendors and assets.

Start with lightweight asset inventory and service relationships. Do not claim full CMDB functionality until discovery, reconciliation, relationship integrity, ownership, and audit capabilities are implemented.

### Pillar E — Integrations and extensibility

**Goal:** Make EffDesk the coordination layer across customers' existing systems.

Priority integrations:
- **Identity/productivity:** Microsoft Entra ID, Microsoft 365/Teams, Google Workspace, Okta, Slack.
- **Development:** GitHub, GitLab, Jira, Linear (continue hardening existing integrations).
- **Monitoring/on-call:** Datadog, PagerDuty, Sentry, AWS CloudWatch, Azure Monitor.
- **Endpoint/asset:** Microsoft Intune and common RMM/MDM platforms.
- **CRM/business:** Salesforce, HubSpot, Stripe.
- **Communications:** Twilio for SMS/voice/WhatsApp capabilities where supported.

Platform capabilities:
- Versioned public REST API, scoped API tokens and service accounts.
- Signed webhooks with retries, replay protection and delivery history.
- OAuth connection per tenant, with platform-shared credentials as an optional default.
- Integration health, scopes, last sync, error logs, disconnect and credential rotation.
- Common connector framework for auth, rate limits, pagination, idempotency, mapping and webhook verification.
- Zapier/n8n compatibility through documented APIs and webhooks before investing in bespoke marketplaces.

### Pillar F — Analytics and service intelligence

Capabilities:
- Operational dashboards for volume, backlog, response/resolution, SLA, CSAT and workload.
- Company/account health view with entitlements, service history and trends.
- Incident impact and affected-service reporting.
- Workflow and AI resolution rates, handoff rates, cost and failure rates.
- Custom report filters, scheduled exports and role-aware access.
- Natural-language questions translated into safe, bounded report queries.

## 4. Recommended navigation model

Navigation should be modular, permission-aware, and progressively disclosed.

- **Workspace:** Tickets, Contacts, Companies, Dashboards.
- **Service Management:** Service Catalog, Requests & Approvals, Incidents, Problems, Changes, Knowledge.
- **IT Operations:** Assets, Services/CMDB, Monitoring, On-call.
- **Intelligence:** AI Copilot, AI Agents, Automations, Analytics.
- **Administration:** Integrations, Agents & Teams, Roles & Security, Configuration.

Do not expose empty or unavailable modules. Each navigation item, route, API action, and data query must enforce the same feature entitlement and permission. Keep the existing navigation conventions and avoid a disruptive redesign in a single release.

## 5. Packaging direction

Use current plan and entitlement infrastructure; do not change prices or move features between plans without a separate commercial decision.

| Edition direction | Customer | Capability bundle |
|---|---|---|
| Free / Essential | Small teams | Core ticketing, basic portal and essential collaboration |
| Team / Professional | Growing support teams | Queues, SLAs, automations, request forms, integrations and reporting |
| Suite / Business | Multi-channel and service teams | Advanced portal, custom fields, AI assistance, chat and WhatsApp |
| Pro / Enterprise | Larger organizations | Governance, advanced AI, SSO, API, advanced workflows and future ITSM modules |

Commercial decisions still required:
- Which capabilities are paid add-ons versus plan inclusions.
- AI usage quotas, overages and model cost controls.
- Asset/CMDB record limits and integration limits.
- Enterprise security, support, data residency and retention commitments.
- Whether external customers, employees and agents have distinct seat/usage rules.

## 6. Prioritized implementation roadmap

### Phase 0 — Reliability and product architecture

- Maintain a capability inventory so roadmap documents do not become stale.
- Add a migration-prefix uniqueness check for future files. The runner sorts filenames lexicographically and records the exact filename; the two existing 037 files therefore have deterministic order, but should remain immutable once applied. Use 040 for the next migration rather than renaming applied files.
- Expand automated tests for tenant isolation, permissions, plan gates and integration failure modes.
- Add end-to-end smoke tests for the most important agent and requester journeys.
- Establish consistent audit events, error reporting, rate limits and background job conventions.

**Exit criteria:** A repeatable CI test run, verified migration ordering, and confidence that new tenant-scoped modules cannot leak cross-tenant data.

### Phase 1 — Service catalog and approvals

- Evolve existing request forms into catalog items with categories, descriptions, instructions and conditional fields.
- Introduce request lifecycle and approval records, including approver assignment, decisions, comments, timestamps and audit history.
- Support sequential and all-required approval policies first; defer complex quorum/delegation rules.
- Surface approvals in requester and agent views.
- Add reusable request fulfillment tasks and notifications.
- Keep catalog items and approvals tenant-scoped and permission-controlled.

**Exit criteria:** An administrator can publish a request item, a requester can submit it, configured approvers can approve/reject it, and the request's state/history remain consistent.

### Phase 2 — Knowledge and customer experience

- Knowledge categories, drafts/review/publish workflow and feedback analytics.
- Contextual article suggestions in the ticket composer and portal.
- Customer portal request history and company-aware service entitlements.
- Customer-facing status and incident communications.

### Phase 3 — AI copilot and supervised agents

- Grounded retrieval and source citations.
- Copilot actions in the ticket workspace.
- Tool registry with per-tenant credentials and user permission checks.
- Agent builder, approval gates, budgets, action traces and evaluation.
- Start with low-risk, reversible tasks before autonomous customer-facing actions.

### Phase 4 — Incident and IT operations

- Major incidents and correlated tickets. **Implemented:** tenant-scoped incident details, affected business services, major-incident coordination and the agent incident console (PRs #23–#24).
- Problem/change records. **Problem Management initial slice implemented:** problem register, root-cause analysis, known-error/workaround/resolution fields, incident associations and activity history (PR #26). Change Management remains next.
- Lightweight assets and service relationships.
- Monitoring and on-call integrations.
- Expand toward CMDB only after the data model and reconciliation model are proven.

### Phase 5 — Integration ecosystem and analytics

- Connector framework and integration health.
- Prioritized native connectors.
- Public API, webhooks, service accounts and recipes.
- Scheduled reporting and natural-language analytics.

## 7. Technical architecture guardrails

### Tenant data model
- Every tenant-owned table includes org_id, tenant RLS with FORCE RLS, and indexes beginning with org_id for common access patterns.
- Foreign keys that relate tenant-owned records should prevent cross-tenant references. Prefer composite (org_id, id) keys or explicit tenant validation where compatible with the current schema.
- Every API handler derives the tenant from the authenticated membership/context, never trusts a caller-supplied org_id by itself.
- Background jobs and webhook handlers must establish tenant context before reading or writing tenant data.

### Permissions and entitlements
- Keep feature entitlement checks separate from role permission checks.
- Enforce both server-side; client-side navigation is presentation only.
- Use explicit permissions for approving, configuring, publishing, executing and auditing workflows.
- Light agents and external requesters must have narrowly scoped access.

### Schema and migrations
- Use additive migrations, backfills that are deterministic and bounded, indexes for query paths, and rollback/forward-repair notes.
- Avoid a migration that silently rewrites large tenant tables during a request.
- Validate every new table under forced RLS in tests.
- Resolve duplicate migration numbering before the next schema migration.

### Async work and integrations
- Use durable jobs for long-running workflows, retries, scheduled actions and external sync.
- Make webhook processing idempotent and verify signatures/tokens before parsing trusted event data.
- Encrypt OAuth credentials at rest; never return secrets to the browser after save.
- Log correlation IDs and safe error summaries without tokens or sensitive ticket content.

### UX
- Preserve the current fast desk experience.
- Make empty states actionable and explain feature availability.
- Use progressive disclosure and reusable visual patterns.
- Ensure keyboard navigation, responsive layouts, loading/error states and accessible labels.
- Keep tenant branding consistent across the agent desk, portal and integration settings.

## 8. Definition of done for every feature

A feature is not complete until:
- The migration is deterministic and tested.
- All reads/writes are tenant-scoped and RLS-tested.
- Server-side plan and permission checks are present.
- UI includes loading, empty, success and error states.
- Audit and observability are added for consequential actions.
- API behavior and operator configuration are documented.
- Automated tests cover success, validation, unauthorized access, cross-tenant access and failure/retry cases.
- A deploy preview or staging environment has been exercised before production rollout.

## 9. First implementation slice

Start with **Phase 0 reliability and Phase 1 service catalog/approvals**. The repository already has request forms and custom fields, so reuse them rather than creating a parallel catalog subsystem.

Before adding the first approval migration:
1. Preserve both already-applied 037 migration filenames; the runner sorts lexicographically and tracks exact filenames. Start the next migration at 040 and add a check that prevents future duplicate numeric prefixes.
2. Map current request-form submission, ticket lifecycle, custom role permissions, notification and audit patterns.
3. Define approval state transitions and the effect of pending/rejected/approved requests on ticket fulfillment.
4. Add tenant-isolation and authorization tests before exposing the UI.

This is the first engineering milestone. It deliberately does not promise a full workflow engine, full CMDB, or autonomous AI platform in one release.
