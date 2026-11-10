// src/db.js: THE DATABASE (Neon Postgres). One pool per function instance; use the POOLED connection string (host with -pooler) in production.
import pg from 'pg';
let pool = null;
export function getPool(url = process.env.DATABASE_URL) {
  if (pool) return pool;
  if (!url) throw new Error('DATABASE_URL is not set');
  pool = new pg.Pool({ connectionString: url, max: 5, idleTimeoutMillis: 10000, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } });
  return pool;
}
export const makePool = url => new pg.Pool({ connectionString: url, max: 5 });
// run fn(client) in one transaction scoped to one organization: row level security then shows that organization's rows only
export async function withOrg(pool, orgId, fn) {
  if (!orgId || typeof orgId !== 'string') throw new Error('An organization id is required');
  const c = await pool.connect();
  try {
    await c.query("begin; select set_config('app.org_id', " + c.escapeLiteral(orgId) + ", true)");     // one round trip, not two
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) { try { await c.query('rollback'); } catch { /* the connection is gone */ } throw e; } finally { c.release(); }
}
