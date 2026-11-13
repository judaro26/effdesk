**Updated:** 2026-11-12

This short roadmap is now a summary; the implementation blueprint lives in [PRODUCT-MASTER-PLAN.md](PRODUCT-MASTER-PLAN.md).

## Product direction

Position EffDesk as an AI-native, multi-tenant service operations platform: simple to deploy and operate, with customer support, service requests, IT operations, integrations, and supervised AI automation in one product.

## Immediate priorities

1. **Reliability and architecture:** resolve migration ordering, strengthen tenant-isolation/permission tests, and add repeatable end-to-end smoke tests.
2. **Service catalog and approvals:** evolve existing request forms and custom fields into catalog items; add tenant-scoped approval records, decision history, notifications, and fulfillment tasks.
3. **Knowledge and customer experience:** categories, article review/publishing, contextual AI suggestions, and improved requester portal.
4. **AI copilot and supervised agents:** grounded retrieval, scoped tools, approval gates, action traces, budgets and evaluation.
5. **ITSM foundations:** major incidents, problem/change management, lightweight asset inventory and service relationships.
6. **Integration ecosystem and analytics:** connector framework, identity/productivity, monitoring/on-call, endpoint management, CRM, public API and advanced reporting.

## Existing capabilities to extend

EffDesk already has multi-tenant organizations and RLS, tickets, queues, SLAs, triggers, request forms, custom fields, customer portal, help center, contacts/companies, AI assistance, API tokens, webhooks, and Linear/Jira integrations. Avoid rebuilding these as parallel systems; extend the existing modules and entitlement model.

## Implementation rules

- Every tenant-owned record and integration is tenant-scoped and protected by forced RLS.
- Enforce feature entitlements and role permissions on the server.
- Use additive, deterministic migrations and test cross-tenant access.
- Keep long-running workflow execution durable, idempotent and observable.
- Require human approval for sensitive or irreversible AI actions.
- Ship in independently testable pull requests; deploy previews before production.

See [PRODUCT-MASTER-PLAN.md](PRODUCT-MASTER-PLAN.md) for capability details, architecture guardrails, packaging direction, phase exit criteria and the first implementation slice.
