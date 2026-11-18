# Staging database role security audit

Run the manual **Staging database role security audit** GitHub Actions workflow after setting `STAGING_DATABASE_URL` to the same pooled connection string used by the staging application.

The check is read-only. It refuses non-Neon, non-pooled, or non-staging/test database URLs and never prints credentials. It inspects both PostgreSQL `session_user` and `current_user` and fails if either is a superuser or has `BYPASSRLS`.

A passing result confirms that the staging connection role itself does not bypass row-level security. It does not replace the tenant-policy audit or cross-tenant regression tests. If the check fails, provision a dedicated least-privilege runtime role without superuser or `BYPASSRLS`, grant only the privileges the application needs, and point the staging app at that role before proceeding. Do not weaken RLS policies to make the check pass.


## Separate runtime and migration connections

The staging application's `DATABASE_URL` must use the restricted runtime role (without `BYPASSRLS`). Netlify production builds also apply schema migrations, which require DDL privileges and must not run as that restricted role.

Configure a separate `DATABASE_MIGRATION_URL` in Netlify with the existing owner/migration connection string, and set its environment-variable scope to **Builds only**. Keep `DATABASE_URL` scoped to the functions/runtime that serve the application. The build migration script prefers `DATABASE_MIGRATION_URL`; it falls back to `DATABASE_URL` only for legacy deployments, with a warning.

Do not grant schema ownership or broad DDL privileges to the runtime role merely to make deploys succeed. After configuring the build-scoped migration variable, redeploy, then rerun the runtime-role audit to confirm the GitHub staging connection still uses the restricted role.
