// scripts/lib/pg-temp.js: a throwaway Postgres for the tests. Uses TEST_DATABASE_URL when it is set; otherwise starts a private cluster from the installed server (run as root it switches to the postgres user).
import { execFileSync, spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path'; import net from 'net';
import pg from 'pg';

const bindir = () => { for (const d of fs.existsSync('/usr/lib/postgresql') ? fs.readdirSync('/usr/lib/postgresql').sort().reverse() : []) { const b = `/usr/lib/postgresql/${d}/bin`; if (fs.existsSync(`${b}/initdb`)) return b; } try { return execFileSync('pg_config', ['--bindir']).toString().trim(); } catch { return ''; } };
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let cluster = null;
export async function startPostgres() {
  if (process.env.TEST_DATABASE_URL) return { url: process.env.TEST_DATABASE_URL, stop() {} };
  if (cluster) return cluster;
  const bin = bindir(); if (!bin) throw new Error('No PostgreSQL server found. Install one or set TEST_DATABASE_URL.');
  const root = process.getuid && process.getuid() === 0, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effdesk-pg-')), port = await freePort();
  if (root) fs.chownSync(dir, Number(execFileSync('id', ['-u', 'postgres'])), Number(execFileSync('id', ['-g', 'postgres'])));
  const run = (cmd, args) => { const r = root ? spawnSync('su', ['postgres', '-s', '/bin/bash', '-c', `${cmd} ${args.map(a => `'${a}'`).join(' ')}`], { encoding: 'utf8' }) : spawnSync(cmd, args, { encoding: 'utf8' }); if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr || r.stdout}`); };
  run(`${bin}/initdb`, ['-D', `${dir}/data`, '-A', 'trust', '-U', 'postgres', '-E', 'UTF8']);
  run(`${bin}/pg_ctl`, ['-D', `${dir}/data`, '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`, '-l', `${dir}/log`, '-w', 'start']);
  const stop = () => { try { run(`${bin}/pg_ctl`, ['-D', `${dir}/data`, '-m', 'immediate', 'stop']); } catch { /* already stopped */ } try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* left behind */ } };
  process.on('exit', stop);
  cluster = { url: `postgres://postgres@127.0.0.1:${port}/postgres`, stop };
  return cluster;
}
// Create a separate empty database for each test, even when TEST_DATABASE_URL names a database other than "postgres".
export async function freshDb(name) {
  const c = await startPostgres(), admin = new pg.Client({ connectionString: c.url }); await admin.connect();
  const db = `t_${name}_${Date.now().toString(36)}`; await admin.query(`create database ${db}`); await admin.end();
  const dbUrl = new URL(c.url); dbUrl.pathname = `/${db}`;
  return { url: dbUrl.toString() };
}
