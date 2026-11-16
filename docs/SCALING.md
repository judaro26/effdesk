# Speed and scaling

`node scripts/bench.js 100000` seeds a throwaway Postgres with 100,000 tickets and 400,000 messages in one workspace (plus 30 small ones) and times the screens that run most. It is not part of `npm test`.

Median times on the first run, then after migration 022 (indexes) and the report rewrite:

| Screen | Before | After |
| --- | --- | --- |
| Ticket list | 65 ms | 22 ms |
| Page 200 of the list | 78 ms | 23 ms |
| Search by text | 88 ms | 22 ms |
| Search by email | 98 ms | 37 ms |
| Reports (30 days) | 1357 ms | 68 ms |
| Agent detail | 100 ms | 22 ms |
| Team list | 60 ms | 35 ms |

What was slow and why: the report counted tickets per day with 60 scans of the table (now one grouped query with a range index); the default list sorted all of a workspace's tickets on every open (now an index in the list's own order); searches read every row (now trigram indexes, `pg_trgm`).

## Reading the benchmark

The benchmark reports p50, p95 and p99 latency, maximum latency, and sampled pool pressure during concurrent bursts. It also compares the deep-offset ticket page with keyset cursor pages. It seeds a throwaway database; its timings are not a production capacity guarantee. Before increasing tenant or agent limits, run the same workload against a staging deployment using the production Neon region and pooled connection configuration, then compare request latency, database saturation, pool waiters and recovery after the burst.

## What to do in production
- Use Neon's **pooled** connection string (host with `-pooler`) for `DATABASE_URL`. Each function instance keeps at most 10 connections (`src/db.js`); the pooler multiplexes them.
- Keep the Netlify site and the Neon database in the same region. Every screen is a handful of database round trips, so distance costs more than any query.
- Look at Neon's query insights monthly. Anything over ~100 ms at your size is worth an index; add it as the next numbered migration and run `scripts/bench.js` first.
- Large workspaces: ticket lists page 50 at a time, exports come in parts of 300 tickets, reports cap the rows they read (`ROW_CAP`).

## Already in place
- A request looks up the plan and the custom role side by side; entering a workspace's context takes one round trip instead of two.
- Scripts and styles are cached by the browser for 5 minutes and refreshed in the background (netlify.toml).
- Everything per workspace is behind row level security with an index that starts with `org_id`, so one busy customer does not slow another.

## Next steps when needed
- A per-workspace ticket counter table (list tabs currently count with a group-by, about 20 ms at 100,000 tickets).
- Move outbound email delivery to the durable job queue; webhook delivery is now queued and retried independently of ticket requests.
- Full-text search (`tsvector`) when searching message bodies.

## Durable asynchronous delivery

Outbound webhooks are written to the tenant-scoped `background_jobs` outbox instead of being sent during ticket requests. PostgreSQL `SKIP LOCKED` claims and worker leases prevent overlapping workers from owning the same job. Failed deliveries retry with exponential backoff (up to one hour), up to eight attempts by default; terminal failures remain available for inspection. A Netlify scheduled worker runs once per minute and processes up to five deliveries concurrently.

Webhook delivery is at-least-once: a receiver may see the same event again if the endpoint accepted it but the response was lost. JSON webhook payloads include an `eventId`, also sent in `X-EffDesk-Event-Id`, so receivers can deduplicate. Public ticket replies, agent ticket notices, and CSAT survey emails use the durable email outbox; authentication, invitations, approval workflow notices, and platform alerts remain synchronous.

## Speed measures (Nov 2026)
- Scripts and stylesheets are minified at deploy time (`scripts/minify-assets.js`, about 22% smaller before compression); the files in git stay readable. If minifying fails the deploy continues with the originals.
- Sign-in is built lazily per function instance, so the public help center, chat and health checks start without loading it.
- Each instance remembers a workspace's plan for 10 seconds (`ENT_CACHE_MS`, off outside Netlify; cleared at once by admin changes, licences and Paddle events on the same instance) and the session for 60 seconds (Better Auth cookie cache).
- Anonymous help pages are cached at the Netlify CDN for 60 seconds.
- Database pool: 10 connections per instance. `node scripts/profile-queries.js` prints how many queries the main requests make.


### Outbound ticket email delivery

Public ticket replies are persisted first and then placed in the tenant-scoped background job outbox. The scheduled worker loads the message and attachment bytes at delivery time, sends through Resend with a stable per-message idempotency key and deterministic Message-ID, and retries transient failures with the existing lease/backoff policy. The API returns `email: queued`; the message delivery state progresses through queued, sent, skipped, or failed. Only the small ticket/message reference is stored in the job payload, not message bodies or attachment contents. Other transactional email (invites, authentication, notices, and surveys) remains synchronous for now.


### Agent notices and CSAT delivery

Ticket assignment, follower, and customer-reply notices are queued per recipient. The worker reloads current workspace membership, notification preferences, and ticket assignment/follower state before sending, so stale or revoked recipients are skipped. CSAT survey emails are also queued after the one-per-ticket rating record is created. Both job types use the shared tenant-scoped retry/lease system and stable Resend idempotency keys. The email payload contains references and short notice metadata rather than message bodies or attachment data.
