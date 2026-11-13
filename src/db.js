// src/db.js: THE DATABASE (Neon Postgres). One pool per function instance; use the POOLED connection string (host with -pooler) in production.
import pg from 'pg';
import { recordSqlQuery } from './performance.js';
import { currentRequest } from './log.js';
let pool = null;
// pg treats sslmode=require/prefer/verify-ca as verify-full and prints a security warning about it; say verify-full so the behaviour is explicit and the warning goes away
export const explicitSsl = url => String(url).replace(/([?&]sslmode=)(require|prefer|verify-ca)(?=&|$)/, '$1verify-full');

const instrumentedClients = new WeakSet();
function instrumentPool(p) {
  const connect = p.connect.bind(p);
  p.connect = function (...args) {
    if (typeof args[0] === 'function') {
      const cb = args[0];
      args[0] = (err, client, release) => { if (!err && client) instrumentClient(client, p); return cb(err, client, release); };
      return connect(...args);
    }
    return connect(...args).then(client => { instrumentClient(client, p); return client; });
  };
}
function instrumentClient(client, pool) {
  if (instrumentedClients.has(client)) return;
  instrumentedClients.add(client);
  const query = client.query.bind(client);
  client.query = function (...args) {
    const sql = typeof args[0] === 'string' ? args[0] : args[0] && args[0].text;
    if (!sql || /performance_(?:minute|query_minute|vitals_minute)/i.test(sql)) return query(...args);
    const started = Date.now(), ctx = currentRequest() || {};
    const callbackIndex = args.findIndex(x => typeof x === 'function');
    const finish = error => {
      void recordSqlQuery(pool, { sql, ms: Date.now() - started, error: !!error, fn: ctx.fn, org: ctx.org, at: Date.now() }).catch(() => null);
    };
    if (callbackIndex >= 0) {
      const cb = args[callbackIndex];
      args[callbackIndex] = function (err, result) { finish(err); return cb(err, result); };
      return query(...args);
    }
    const result = query(...args);
    return result && typeof result.then === 'function'
      ? result.then(value => { finish(null); return value; }, error => { finish(error); throw error; })
      : result;
  };
}

export function getPool(url = process.env.DATABASE_URL) {
  if (pool) return pool;
  if (!url) throw new Error('DATABASE_URL is not set');
  url = explicitSsl(url);
  pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 10000, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: true } });
  instrumentPool(pool);
  return pool;
}
export const makePool = url => new pg.Pool({ connectionString: explicitSsl(url), max: 5 });
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
