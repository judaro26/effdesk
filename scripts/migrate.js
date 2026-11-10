// scripts/migrate.js: applies migrations/*.sql in order, once each (npm run migrate, with DATABASE_URL set). Used by the tests too.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import pg from 'pg';
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
export async function migrate(url) {
  const c = new pg.Client({ connectionString: url }); await c.connect();
  try {
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map(r => r.name)), ran = [];
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(f)) continue;
      await c.query('begin'); try { await c.query(fs.readFileSync(path.join(dir, f), 'utf8')); await c.query('insert into schema_migrations (name) values ($1)', [f]); await c.query('commit'); ran.push(f); } catch (e) { await c.query('rollback'); throw new Error(`${f}: ${e.message}`); }
    }
    return ran;
  } finally { await c.end(); }
}
if (import.meta.url === `file://${process.argv[1]}`) { migrate(process.env.DATABASE_URL).then(r => console.log(r.length ? 'applied: ' + r.join(', ') : 'up to date'), e => { console.error(e.message); process.exit(1); }); }
