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
