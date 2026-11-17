## Staging multi-tenant load test

The manual **Staging multi-tenant load test** GitHub Actions workflow offers two workload types against a dedicated Neon staging database: read-only ticket/dashboard/Live Chat inbox/report reads, or a mixed visitor-poll and agent-inbox workload. The read-only workload reports p50/p95/p99 latency, failures, throughput, sampled Node PostgreSQL pool pressure, connection-acquisition wait percentiles, and the 12 query fingerprints with the highest cumulative execution time. The mixed workload reports visitor-poll and agent-inbox latency plus connection-pool pressure, connection-acquisition wait, and connection lease duration (time a request holds a checked-out client); it updates only the synthetic conversations' visitor-seen timestamp. Query fingerprints are short SHA-256 identifiers, accompanied by redacted SQL shapes; bind values, tenant IDs, and customer content are never emitted. The mixed workload performs one unmeasured warm-up round at the selected concurrency, then runs each measured round separately and reports both per-round and aggregate request-level percentiles. Setup and warm-up connection waits are excluded from measured acquisition percentiles. Use repeated runs and compare the individual rounds; this reduces cold-cache bias but does not eliminate Neon Free compute, network, or shared-resource variability.

Lease duration is captured from node-postgres pool `acquire` and `release` lifecycle events, so it covers both callback- and promise-based client checkout paths.

### One-time setup

1. Create a dedicated Neon staging database. Do not point this workflow at production.
2. Add the staging **pooled** connection string as the GitHub Actions repository secret `STAGING_DATABASE_URL`. Its hostname must include `-pooler` and end in `.neon.tech`.
3. Seed synthetic workspaces using the guarded seeder below. It applies migrations and creates 10 workspaces by default, each with 3 synthetic agents, 100 tickets, and 20 Live Chat conversations. It also grants the `live_chat` feature override only to the generated `stg_effdesk_org_NN` workspaces in this staging database. It is idempotent and refuses non-staging database names.
4. Add the generated organization IDs, comma-separated, as the repository Actions variable `STAGING_ORG_IDS` (2–30 IDs).
5. Run the workflow manually with `smoke` first. Increase to `standard` or `stress` only after checking staging database health.

The harness refuses to connect unless the database name explicitly contains `staging`, `stage`, or `test`. It requires the explicit workflow confirmation, is serialized to prevent overlapping runs, and performs no inserts, updates, deletes, migrations, or schema changes. Use synthetic data only; do not use production customer records in staging.

### Profiles

| Profile | Concurrent workers | Rounds per scenario/workspace |
| --- | ---: | ---: |
| smoke | 5 | 2 |
| standard | 15 | 3 |
| stress | 30 | 3 |

The `read-only` workload runs ticket inbox, agent dashboard, Live Chat inbox, and report reads across the configured workspaces. Results are directional staging measurements, not a production capacity guarantee. The harness does not yet simulate authenticated browser sessions, chat writes/claims, or scheduled job delivery; those require a separate end-to-end scenario with dedicated synthetic agents and visitors. The visitor poll path was separately optimized to reuse assignee details already returned by its tenant-scoped conversation query, avoiding two additional sequential user lookups per poll. The agent inbox now loads its conversation page in one query and combines counts, needs-reply totals, the workspace concurrency setting, and the selected agent's active-chat count into one tenant-scoped metadata query (two SQL round trips total instead of four).

The query diagnostics include each fingerprint's redacted SQL shape to make it easier to identify the application query without exposing bind values or customer data. String and dollar-quoted literals, numeric constants, and SQL comments are removed or masked; long shapes are truncated. Fingerprints continue to hash the original normalized SQL. Use the shape and timing distribution with Neon query insights before changing indexes or query structure.

### Mixed Live Chat workload

The mixed-chat harness uses the same `getPool()` factory as the deployed app, including the configured pool size and sampled SQL-performance instrumentation. Its output separates sampled `performance_*` telemetry writes from application query fingerprints and reports their latency/count. This is intentional: a benchmark-only raw pool would understate production pool demand. The benchmark records the effective SQL sample rate; compare runs using the same setting.


Choose `mixed-chat` in the workflow to run `scripts/bench-chat-mixed.js`. It executes three visitor polls for each agent inbox refresh across the seeded workspaces, at the selected concurrency. It uses the existing synthetic visitor conversations and a benchmark-only token secret; it does not create messages or tickets. Visitor polls may refresh `last_visitor_seen_at` (throttled by the application to once per 15 seconds), so this workload is not strictly read-only and must only target the dedicated synthetic staging database. The workflow retains the pooled-Neon and staging-name guard. The staging seeder automatically ensures a `live_chat` feature override for its synthetic `stg_effdesk_org_NN` workspaces, because Live Chat is not included in the Free plan by default. The override helper rejects non-synthetic workspace IDs, and the seeder itself refuses non-staging database names; do not change production customer entitlements for this test. The benchmark fails clearly if a workspace has no active synthetic conversation or Live Chat is unavailable. Its output separates an unmeasured warm-up from measured rounds; aggregate p50/p95/p99 values are calculated from all raw measured request timings, not by averaging round percentiles. Connection-acquisition and connection-lease percentiles are reset after warm-up, SQL query timing samples are cleared after warm-up, and pool pressure sampling covers only the measured phase. Acquisition wait measures time waiting to obtain a client; lease duration measures how long the request holds that client, including tenant transaction setup, SQL work, and commit.

Before raising customer or agent limits, compare results with Neon query insights, compute/connection saturation, and Netlify function latency in the same region.


### Creating synthetic data

After merging the setup PR, the easiest option is GitHub Actions → **Seed synthetic staging workspaces** → Run workflow. Confirm that this is the dedicated staging project, then choose the workspace and data sizes. The workflow uses the existing `STAGING_DATABASE_URL` secret; you never need to paste the URL into a workflow input. Alternatively, run locally from a trusted checkout:

```bash
STAGING_DATABASE_URL='your-staging-pooled-neon-url' npm run seed:staging
```

The command intentionally does not read `DATABASE_URL`. It accepts only a pooled Neon URL whose database name contains `staging`, `stage`, or `test`. Defaults are 10 workspaces, 3 agents, 100 tickets, and 20 Live Chat conversations per workspace. Optional limits are `STAGING_SEED_WORKSPACES` (2–30), `STAGING_SEED_AGENTS` (2–20), `STAGING_SEED_TICKETS` (10–2000), and `STAGING_SEED_CHATS` (5–500). Each workspace is marked with a synthetic-seed marker and skipped on subsequent runs. Use only in the dedicated, empty staging project.

The seed creates synthetic Better Auth user and membership records for query coverage; it does not create usable login credentials or send invitations. The load test exercises application query functions directly, not authenticated browser sessions.
