## Staging deployed-HTTP Live Chat benchmark

The manual workflow **Staging HTTP Live Chat benchmark** exercises the deployed staging site's public widget configuration and visitor-poll endpoints over HTTPS. It uses the existing synthetic conversations in the dedicated Neon staging database.

Required GitHub configuration:
- Secret `STAGING_DATABASE_URL`: the existing pooled Neon staging connection string.
- Secret `STAGING_CHAT_TOKEN_SECRET`: the staging site's effective `EMAIL_TOKEN_SECRET` value (or `BETTER_AUTH_SECRET` only if `EMAIL_TOKEN_SECRET` is not configured). Add it directly in GitHub Actions Secrets; never paste it into chat or commit it.
- Variable `STAGING_ORG_IDS`: the existing comma-separated synthetic workspace IDs.

The staging HTTP host is pinned in the workflow and script to `https://dummy-site-recovery.netlify.app`; production and other hosts are rejected. The workflow has an explicit staging confirmation gate.

Workload behavior:
- Preflight: one public `GET /api/chat/config` per synthetic workspace.
- Measurement: public `GET /api/chat/poll` requests against one existing synthetic active conversation per workspace.
- Polling may refresh `last_visitor_seen_at`, subject to the existing 15-second heartbeat throttle. It does not create chats, messages, tickets, or attachments.
- Profiles: smoke (5 workers, 2 rounds), standard (15 workers, 3 rounds), stress (30 workers, 3 rounds).
- Reports HTTP latency percentiles, successful requests, failures, and approximate throughput.

This measures the deployed Netlify HTTP path for the public visitor experience. It does not yet measure authenticated agent inbox HTTP traffic; that requires a dedicated staging agent identity/session with Live Chat access. It is also not a production capacity guarantee: results depend on Netlify function placement, Neon Free staging, and current network conditions.


## Hot-tenant fairness benchmark

The **Staging multi-tenant load test** workflow also offers the `tenant-fairness` workload. It is read-only and sends 70% of its requests to the first ID in `STAGING_ORG_IDS`, while spreading the remaining 30% over the other synthetic workspaces. It runs ticket inbox, dashboard, Live Chat inbox, and 30-day report reads, then reports latency and failures separately for the hot tenant and control tenants.

Use at least 10 synthetic workspaces for a useful comparison. The existing staging seeder supports up to 30 workspaces; seed 30 and update the `STAGING_ORG_IDS` repository variable to list `stg_effdesk_org_01` through `stg_effdesk_org_30` before selecting this workload. The workload performs no writes and does not create tickets, messages, or chats.

This is an application/database fairness benchmark, not a deployed HTTP/browser test. It measures whether ordinary tenants remain responsive while one tenant receives disproportionate read traffic. It does not by itself establish production capacity or test write-heavy abuse scenarios.
