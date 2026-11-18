// Validate the effective tenant boundary of PostgreSQL RLS policies.
// PostgreSQL ORs permissive policies together, so every permissive policy that
// applies to a command must enforce the tenant predicate. Restrictive policies
// are combined with AND and cannot broaden access.
const TENANT_PREDICATE = /^\(*\s*org_id\s*=\s*current_setting\(\s*'app\.org_id'\s*(?:::text)?\s*,\s*true\s*\)\s*\)*$/i;

export function isTenantPredicate(expression) {
  return typeof expression === 'string' && TENANT_PREDICATE.test(expression.trim());
}

export function auditTenantPolicies(policies = []) {
  const problems = [];
  const permissive = policies.filter(policy => String(policy.permissive || '').toUpperCase() !== 'RESTRICTIVE');
  const commands = [
    { name: 'SELECT', using: true, check: false },
    { name: 'INSERT', using: false, check: true },
    { name: 'UPDATE', using: true, check: true },
    { name: 'DELETE', using: true, check: false }
  ];

  for (const command of commands) {
    const covering = permissive.filter(policy => {
      const applies = String(policy.cmd || '').toUpperCase();
      return applies === 'ALL' || applies === command.name;
    });
    if (!covering.length) {
      problems.push(`No permissive policy covers ${command.name}`);
      continue;
    }
    for (const policy of covering) {
      const name = String(policy.policyname || 'unnamed');
      if (command.using && !isTenantPredicate(policy.qual)) {
        problems.push(`Permissive policy "${name}" does not enforce tenant scope in USING for ${command.name}`);
      }
      if (command.check && !isTenantPredicate(policy.with_check)) {
        problems.push(`Permissive policy "${name}" does not enforce tenant scope in WITH CHECK for ${command.name}`);
      }
    }
  }
  return problems;
}
