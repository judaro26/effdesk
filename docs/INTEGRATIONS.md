# External integrations

EffDesk integrations are organization-scoped. A customer workspace owns its own authorization, webhook destinations, event subscriptions, and connection lifecycle. Never reuse credentials or connection records across organizations.

## Current connections

| Category | Provider | Connection method | Current capability |
|---|---|---|---|
| Communications | Slack | Incoming webhook | Ticket-created/updated, agent/customer reply, mention notifications |
| Communications | Zoho Cliq | Incoming webhook | Ticket-created/updated, agent/customer reply, mention notifications |
| Communications | Microsoft Teams | Incoming webhook | Ticket notifications using an Adaptive Card payload |
| Issue tracking | Jira Cloud | Tenant OAuth | Linked issues, issue templates, two-way ticket/issue synchronization |
| Issue tracking | Linear | Tenant OAuth | Linked issues, issue templates, two-way ticket/issue synchronization |
| Developer tools | GitHub | Customer-owned personal access token | Encrypted account connection and credential health check; repository/PR synchronization is a subsequent adapter phase |
| Developer tools | GitLab | Customer-owned personal access token | Encrypted account connection and credential health check; project/MR synchronization is a subsequent adapter phase |
| Developer automation | Custom webhooks | Signed HTTPS JSON | HMAC-signed event delivery for customer-owned systems, Zapier, Make, and custom receivers |

Chat destinations are configured from the native Desk > External Integrations page. The Developer webhooks area remains for signed JSON endpoints. Incoming chat webhook URLs are validated against provider-specific hostnames; never render the complete URL back into the UI because it can contain a credential.

## Delivery and security

- Every connection belongs to one EffDesk organization.
- Existing database access uses organization-scoped queries and RLS.
- Chat destinations accept only HTTPS endpoints on provider-owned hostnames.
- Outbound delivery is best-effort and must never block ticket creation or updates.
- Delivery status and last-attempt time are recorded.
- Provider credentials must be customer-managed where OAuth or API credentials are required; EffDesk must not require customers to share secrets with other tenants.
- Never log access tokens, webhook URLs, signing secrets, or OAuth client secrets.

## Planned provider adapters

The integration catalog roadmap includes Microsoft Entra ID, Okta, Google Workspace, Azure DevOps, PagerDuty, Rootly, FireHydrant, Datadog, Grafana, Splunk, Sentry, Microsoft Intune, Jamf, AWS, Microsoft Azure, Salesforce, HubSpot, Zapier, Make, n8n, Microsoft Defender, and CrowdStrike. GitHub and GitLab now support tenant-owned personal access token verification and encrypted storage; repository, issue, pull-request, and merge-request synchronization remains planned.

These are catalog/roadmap entries, not active connectors until their OAuth/API adapter, tenant-scoped credential lifecycle, webhook verification, synchronization rules, and automated tests are implemented. Do not expose a Connect action for a provider until that provider's adapter is operational.

## Rollout checklist for each new provider

1. Document supported API scopes and customer-owned credential setup.
2. Store credentials encrypted and bind them to the organization and provider.
3. Verify OAuth state, callback origin, webhook signatures, and replay protection.
4. Enforce admin-only connection management and tenant isolation on every request.
5. Add connection health, last-success time, actionable errors, and safe disconnect/revoke behavior.
6. Add automated tests for authorization, cross-tenant access, expiry/refresh, retries, duplicate events, and provider payloads.
7. Keep optional provider credentials out of the shared EffDesk deployment when customers can supply their own.

## Tenant-owned GitHub and GitLab credentials

The first developer-platform adapter phase supports GitHub and GitLab account connection using a personal access token created by the customer. The token is verified against the provider's fixed current-user endpoint before it is encrypted and stored. Only the account identity, provider-reported scopes, connection health, and timestamps are returned to the browser.

- GitHub uses `GET https://api.github.com/user` with a bearer token and the supported API version header.
- GitLab uses `GET https://gitlab.com/api/v4/user` with a bearer token.
- Tokens are encrypted using the existing application secret and stored in the organization-scoped `integration_connections` table.
- The list and health-check responses never include credentials.
- Only workspace owners and admins can list, connect, test, or disconnect these providers.
- Disconnect removes the encrypted token from EffDesk. The customer should also revoke the personal access token in GitHub or GitLab.
- The current adapter verifies account identity and token health only. Repository inventory, ticket-to-issue links, pull/merge-request activity, and deployment events are separate follow-up capabilities and must not be represented as active yet.
