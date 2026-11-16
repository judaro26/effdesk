## Staging multi-tenant load test

The manual **Staging multi-tenant load test** GitHub Actions workflow runs the existing ticket, dashboard, Live Chat inbox, and 30-day report query paths concurrently against a dedicated Neon staging database. It performs read-only requests and reports p50/p95/p99 latency, failures, throughput, sampled Node PostgreSQL pool pressure, connection-acquisition wait percentiles, and the 12 query fingerprints with the highest cumulative execution time. Query fingerprints are short SHA-256 identifiers, accompanied by redacted SQL shapes; bind values, tenant IDs, and customer content are never emitted.

### One-time setup

1. Create a dedicated Neon staging database. Do not point this workflow at production.
2. Add the staging **pooled** connection string as the GitHub Actions repository secret `STAGING_DATABASE_URL`. Its hostname must include `-pooler` and end in `.neon.tech`.
3. Seed synthetic workspaces using the guarded seeder below. It applies migrations and creates 10 workspaces by default, each with 3 synthetic agents, 100 tickets, and 20 Live Chat conversations. It is idempotent and refuses non-staging database names.
4. Add the generated organization IDs, comma-separated, as the repository Actions variable `STAGING_ORG_IDS` (2–30 IDs).
5. Run the workflow manually with `smoke` first. Increase to `standard` or `stress` only after checking staging database health.

The harness refuses to connect unless the database name explicitly contains `staging`, `stage`, or `test`. It requires the explicit workflow confirmation, is serialized to prevent overlapping runs, and performs no inserts, updates, deletes, migrations, or schema changes. Use synthetic data only; do not use production customer records in staging.

### Profiles

| Profile | Concurrent workers | Rounds per scenario/workspace |
| --- | ---: | ---: |
| smoke | 5 | 2 |
| standard | 15 | 3 |
| stress | 30 | 3 |

Each worker runs ticket inbox, agent dashboard, Live Chat inbox, and report reads across the configured workspaces. Results are directional staging measurements, not a production capacity guarantee. The harness does not yet simulate authenticated browser sessions, visitor polling, chat writes/claims, or scheduled job delivery; those require a separate end-to-end scenario with dedicated synthetic agents and visitors. The visitor poll path was separately optimized to reuse assignee details already returned by its tenant-scoped conversation query, avoiding two additional sequential user lookups per poll. That reduction is not represented in the four current benchmark scenarios.

The query diagnostics include each fingerprint's redacted SQL shape to make it easier to identify the application query without exposing bind values or customer data. String and dollar-quoted literals, numeric constants, and SQL comments are removed or masked; long shapes are truncated. Fingerprints continue to hash the original normalized SQL. Use the shape and timing distribution with Neon query insights before changing indexes or query structure.

Before raising customer or agent limits, compare results with Neon query insights, compute/connection saturation, and Netlify function latency in the same region.


### Creating synthetic data

After merging the setup PR, the easiest option is GitHub Actions → **Seed synthetic staging workspaces** → Run workflow. Confirm that this is the dedicated staging project, then choose the workspace and data sizes. The workflow uses the existing `STAGING_DATABASE_URL` secret; you never need to paste the URL into a workflow input. Alternatively, run locally from a trusted checkout:

```bash
STAGING_DATABASE_URL='your-staging-pooled-neon-url' npm run seed:staging
```

The command intentionally does not read `DATABASE_URL`. It accepts only a pooled Neon URL whose database name contains `staging`, `stage`, or `test`. Defaults are 10 workspaces, 3 agents, 100 tickets, and 20 Live Chat conversations per workspace. Optional limits are `STAGING_SEED_WORKSPACES` (2–30), `STAGING_SEED_AGENTS` (2–20), `STAGING_SEED_TICKETS` (10–2000), and `STAGING_SEED_CHATS` (5–500). Each workspace is marked with a synthetic-seed marker and skipped on subsequent runs. Use only in the dedicated, empty staging project.

The seed creates synthetic Better Auth user and membership records for query coverage; it does not create usable login credentials or send invitations. The load test exercises application query functions directly, not authenticated browser sessions.
