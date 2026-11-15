// Audit tenant-owned PostgreSQL tables for row-level security coverage.
// Run against the target database with DATABASE_URL set:
//   npm run audit:tenant-rls
import { getPool } from '../src/db.js';

const pool = getPool();
try {
  const result = await pool.query(`
    select
      n.nspname as schema_name,
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced,
      count(p.policyname)::int as policy_count,
      coalesce(bool_or(
        coalesce(p.qual, '') ilike '%org_id%'
        and coalesce(p.qual, '') ilike '%app.org_id%'
      ), false) as has_tenant_using,
      coalesce(bool_or(
        coalesce(p.with_check, '') ilike '%org_id%'
        and coalesce(p.with_check, '') ilike '%app.org_id%'
      ), false) as has_tenant_check
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid
      and a.attname = 'org_id' and not a.attisdropped
    left join pg_policies p
      on p.schemaname = n.nspname and p.tablename = c.relname
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
    group by n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
    order by c.relname
  `);

  const findings = result.rows.map(row => {
    const problems = [];
    if (!row.rls_enabled) problems.push('RLS is not enabled');
    if (!row.rls_forced) problems.push('RLS is not forced');
    if (!row.policy_count) problems.push('No RLS policy exists');
    if (!row.has_tenant_using) problems.push('No policy USING clause references org_id and app.org_id');
    if (!row.has_tenant_check) problems.push('No policy WITH CHECK clause references org_id and app.org_id');
    return { ...row, problems };
  });
  const failed = findings.filter(row => row.problems.length);
  console.log(JSON.stringify({
    checked_at: new Date().toISOString(),
    schema: 'public',
    tenant_tables_checked: findings.length,
    passed: findings.length - failed.length,
    failed: failed.length,
    findings
  }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await pool.end();
}
