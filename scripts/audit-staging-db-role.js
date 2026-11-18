// Read-only check that the staging application connection role cannot bypass RLS.
// Requires STAGING_DATABASE_URL; never prints the connection string or credentials.
import { makePool } from '../src/db.js';

function safeStagingUrl(value) {
  let u;
  try { u = new URL(value); } catch { return false; }
  const db = decodeURIComponent(u.pathname.replace(/^\//, ''));
  return ['postgres:', 'postgresql:'].includes(u.protocol)
    && u.hostname.endsWith('.neon.tech')
    && u.hostname.includes('-pooler')
    && /staging|stage|test/i.test(db)
    && !!u.username
    && !!u.password;
}

const url = process.env.STAGING_DATABASE_URL;
if (!safeStagingUrl(url)) {
  console.error('Refusing to connect: STAGING_DATABASE_URL must be a credentialed pooled Neon URL for a staging/test database.');
  process.exit(1);
}

const pool = makePool(url);
try {
  const result = await pool.query(`
    select
      session_user,
      current_user,
      session_role.rolsuper as session_is_superuser,
      session_role.rolbypassrls as session_bypasses_rls,
      current_role.rolsuper as current_is_superuser,
      current_role.rolbypassrls as current_bypasses_rls
    from pg_roles session_role
    join pg_roles current_role on current_role.rolname = current_user
    where session_role.rolname = session_user
  `);
  const role = result.rows[0];
  if (!role) throw new Error('Could not resolve the connected PostgreSQL role.');
  const safe = !role.session_is_superuser
    && !role.session_bypasses_rls
    && !role.current_is_superuser
    && !role.current_bypasses_rls;
  console.log(JSON.stringify({
    database_role: role.current_user,
    session_role: role.session_user,
    session_is_superuser: role.session_is_superuser,
    session_bypasses_rls: role.session_bypasses_rls,
    current_is_superuser: role.current_is_superuser,
    current_bypasses_rls: role.current_bypasses_rls,
    rls_bypass_protection: safe ? 'PASS' : 'FAIL'
  }, null, 2));
  if (!safe) {
    console.error('The staging application database role is a superuser or has BYPASSRLS. Use a dedicated least-privilege runtime role without either attribute.');
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
