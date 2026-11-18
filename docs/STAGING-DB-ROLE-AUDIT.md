# Staging database role security audit

Run the manual **Staging database role security audit** GitHub Actions workflow after setting `STAGING_DATABASE_URL` to the same pooled connection string used by the staging application.

The check is read-only. It refuses non-Neon, non-pooled, or non-staging/test database URLs and never prints credentials. It inspects both PostgreSQL `session_user` and `current_user` and fails if either is a superuser or has `BYPASSRLS`.

A passing result confirms that the staging connection role itself does not bypass row-level security. It does not replace the tenant-policy audit or cross-tenant regression tests. If the check fails, provision a dedicated least-privilege runtime role without superuser or `BYPASSRLS`, grant only the privileges the application needs, and point the staging app at that role before proceeding. Do not weaken RLS policies to make the check pass.
