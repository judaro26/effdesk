// Audit tenant-owned PostgreSQL tables for effective row-level security coverage.
// Run against the same database role used by the application:
//   npm run audit:tenant-rls
import { getPool } from '../src/db.js';
import { auditTenantPolicies, isTenantPredicate } from './lib/tenant-rls-audit.js';

const INTENTIONAL_EXEMPTIONS = {
  inbox_directory: 'Inbound email routing must resolve the organization from the inbox address before an app.org_id context exists; the table stores only the routing mapping.',
  email_receipts: 'Resend delivery callbacks resolve the organization from the provider message ID before tenant context; the table stores receipt routing metadata, not message content.',
  incident_provider_token_registry: 'Hash-only inbound webhook token registry resolves the organization before tenant context; operational connection data remains forced-RLS.',
  monitoring_alert_token_registry: 'Hash-only inbound monitoring token registry resolves the organization before tenant context; operational connection data remains forced-RLS.',
  project_oauth_states: 'Short-lived OAuth state hashes resolve the tenant during the provider callback before tenant context is established.',
  scim_tokens: 'Hash-only SCIM bearer token registry resolves the tenant before tenant-scoped SCIM operations.',
  sso_providers: 'SSO login discovers the tenant by email domain before authentication and tenant context; encrypted client secrets are server-only.',
  subscriptions: 'Platform billing and Paddle callbacks resolve subscriptions across organizations; tenant billing operations are authorized in application code.',
  whatsapp_accounts: 'Meta verification and inbound webhooks resolve the tenant by phone-number ID or verification token before tenant context; credentials are encrypted.',
  support_access: 'Platform-owner support grants are platform control-plane records, not customer-editable tenant data.',
  usage_daily: 'Platform usage rollups are generated and read by platform-owner operations across organizations.',
  usage_alerts: 'Platform usage alert deduplication records are managed by cross-organization platform jobs.',
  error_events: 'Platform-wide operational error telemetry is written by server instrumentation and read only by platform administrators.',
  org_overrides: 'Platform-owner entitlement and suspension overrides are control-plane records administered across organizations.',
  performance_minute: 'Sampled platform-wide request performance aggregates are written by server instrumentation and read by platform administrators.',
  performance_query_minute: 'Sampled SQL performance aggregates are platform observability data, not customer-facing tenant records.',
  performance_vitals_minute: 'Aggregated real-user performance vitals are platform observability data; no user identifiers or page content are stored.',
  status_components: 'Public status-page content supports both the platform page and workspace pages; status APIs explicitly filter by the requested workspace or the platform null scope.',
  status_incidents: 'Public incident and maintenance timelines support both platform and workspace pages; status APIs explicitly filter by the requested workspace or the platform null scope.'
};

const pool = getPool();
try {
  const result = await pool.query(`
    select
      n.nspname as schema_name,
      c.relname as table_name,
      c.relrowsecurity as rls_enabled,
      c.relforcerowsecurity as rls_forced,
      coalesce(
        jsonb_agg(jsonb_build_object(
          'policyname', p.policyname,
          'permissive', p.permissive,
          'cmd', p.cmd,
          'roles', p.roles,
          'qual', p.qual,
          'with_check', p.with_check
        )) filter (where p.policyname is not null),
        '[]'::jsonb
      ) as policies
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
    const policies = row.policies || [];
    const problems = [];
    if (!row.rls_enabled) problems.push('RLS is not enabled');
    if (!row.rls_forced) problems.push('RLS is not forced');
    if (!policies.length) problems.push('No RLS policy exists');
    // A permissive policy is an OR branch. Check every one, not merely whether
    // at least one tenant policy exists; a broad second policy defeats isolation.
    problems.push(...auditTenantPolicies(policies, row.table_name));
    return {
      schema_name: row.schema_name,
      table_name: row.table_name,
      rls_enabled: row.rls_enabled,
      rls_forced: row.rls_forced,
      policy_count: policies.length,
      has_tenant_using: policies.some(p => isTenantPredicate(p.qual)),
      has_tenant_check: policies.some(p => isTenantPredicate(p.with_check)),
      policies,
      problems
    };
  });
  const exempted = findings.filter(row => row.problems.length && INTENTIONAL_EXEMPTIONS[row.table_name]);
  const failed = findings.filter(row => row.problems.length && !INTENTIONAL_EXEMPTIONS[row.table_name]);
  const report = findings.map(row => ({
    ...row,
    classification: !row.problems.length ? 'protected' : INTENTIONAL_EXEMPTIONS[row.table_name] ? 'documented_exception' : 'unapproved_gap',
    exemption_reason: INTENTIONAL_EXEMPTIONS[row.table_name] || null
  }));
  console.log(JSON.stringify({
    checked_at: new Date().toISOString(),
    schema: 'public',
    tenant_tables_checked: findings.length,
    protected: findings.length - exempted.length - failed.length,
    documented_exceptions: exempted.length,
    failed: failed.length,
    findings: report
  }, null, 2));
  if (failed.length) process.exitCode = 1;
} finally {
  await pool.end();
}
