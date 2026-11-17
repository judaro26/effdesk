// Read-only HTTP benchmark against the dedicated Netlify staging deployment.
// It exercises the real public widget config and visitor poll endpoints. Polls refresh
// visitor presence at most once per 15 seconds; no messages, tickets, or chat state changes.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { getPool, withOrg } from '../src/db.js';
import { chatToken } from '../src/chat.js';

export const ALLOWED_STAGING_HOST = 'dummy-site-recovery.netlify.app';
export const profiles = {
  smoke: { concurrency: 5, rounds: 2 },
  standard: { concurrency: 15, rounds: 3 },
  stress: { concurrency: 30, rounds: 3 }
};
export function validateHttpTarget(value) {
  if (!value) throw new Error('STAGING_HTTP_BASE_URL is required.');
  let url;
  try { url = new URL(value); } catch { throw new Error('STAGING_HTTP_BASE_URL must be a valid URL.'); }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== ALLOWED_STAGING_HOST || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error(`Refusing HTTP benchmark target. Only https://${ALLOWED_STAGING_HOST}/ is allowed.`);
  }
  return url.origin;
}
export function parseOrgIds(value) {
  const ids = [...new Set(String(value || '').split(',').map(x => x.trim()).filter(Boolean))];
  if (ids.length < 2 || ids.length > 30 || ids.some(id => !/^stg_effdesk_org_\\d{2}$/.test(id))) {
    throw new Error('STAGING_ORG_IDS must contain 2–30 synthetic stg_effdesk_org_NN workspace IDs.');
  }
  return ids;
}
export function percentileStats(values) {
  const sorted = [...values].sort((a,b) => a-b);
  const at = p => sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)].toFixed(1)) : null;
  return { samples: sorted.length, p50_ms: at(.5), p95_ms: at(.95), p99_ms: at(.99), max_ms: at(1) };
}
const rawBase = process.env.STAGING_HTTP_BASE_URL;
const rawDatabaseUrl = process.env.STAGING_DATABASE_URL;
const tokenSecret = process.env.STAGING_CHAT_TOKEN_SECRET;
const profile = String(process.env.STAGING_BENCH_PROFILE || 'smoke').toLowerCase();

async function main() {
  const base = validateHttpTarget(rawBase);
  const orgIds = parseOrgIds(process.env.STAGING_ORG_IDS);
  const settings = profiles[profile];
  if (!settings) throw new Error('STAGING_BENCH_PROFILE must be smoke, standard, or stress.');
  if (!rawDatabaseUrl) throw new Error('STAGING_DATABASE_URL is required for synthetic chat discovery.');
  if (!tokenSecret || tokenSecret.length < 24) throw new Error('STAGING_CHAT_TOKEN_SECRET is required (the staging EMAIL_TOKEN_SECRET or BETTER_AUTH_SECRET value).');
  const db = new URL(rawDatabaseUrl);
  const dbName = decodeURIComponent(db.pathname.replace(/^\\//, '')).toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.hostname.toLowerCase().endsWith('.neon.tech') || !db.hostname.toLowerCase().includes('-pooler') || !/(^|[_-])(staging|stage|test)([_-]|$)/.test(dbName)) {
    throw new Error('Refusing benchmark: STAGING_DATABASE_URL must target the dedicated pooled Neon staging database.');
  }
  if (process.argv.includes('--check')) {
    console.log(JSON.stringify({ safe: true, http_host: new URL(base).hostname, database: dbName, workspaces: orgIds.length, profile }));
    return;
  }

  const pool = getPool(rawDatabaseUrl);
  const targets = [];
  try {
    for (const orgId of orgIds) {
      const org = (await pool.query('select slug from "organization" where id=$1', [orgId])).rows[0];
      if (!org?.slug || !/^effdesk-staging-\\d{2}$/.test(org.slug)) throw new Error('Missing expected synthetic staging workspace.');
      const chat = await withOrg(pool, orgId, async c => (await c.query(
        "select chat_number from chat_conversations where org_id=$1 and visitor_key like 'stg-visitor-%' and status in ('open','pending','on_hold') order by id limit 1",
        [orgId]
      )).rows[0] || null);
      if (!chat?.chat_number) throw new Error('No active synthetic visitor chat found; rerun the staging seeder.');
      const number = Number(chat.chat_number);
      targets.push({ orgId, slug: org.slug, number, token: chatToken({ EMAIL_TOKEN_SECRET: tokenSecret }, orgId, number) });
    }

    async function request(kind, target) {
      const url = kind === 'config'
        ? new URL('/api/chat/config', base)
        : new URL('/api/chat/poll', base);
      url.searchParams.set('org', target.slug);
      if (kind === 'poll') {
        url.searchParams.set('n', String(target.number));
        url.searchParams.set('t', target.token);
        url.searchParams.set('after', '0');
      }
      const started = performance.now();
      const response = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } });
      const elapsed = performance.now() - started;
      if (!response.ok) throw new Error(`${kind} returned HTTP ${response.status}`);
      const body = await response.json();
      if (body?.ok === false || (kind === 'poll' && !body?.conversation)) throw new Error(`${kind} returned an unsuccessful response`);
      return elapsed;
    }

    const configSamples = [];
    for (const target of targets) configSamples.push(await request('config', target));
    const warmup = await Promise.all(targets.map(target => request('poll', target).catch(error => ({ error: String(error?.message || error) }))));
    const warmupFailures = warmup.filter(x => typeof x !== 'number').length;
    const samples = [], failures = [];
    for (let round = 0; round < settings.rounds; round++) {
      let cursor = 0;
      const roundSamples = [];
      const workers = Array.from({ length: settings.concurrency }, async () => {
        while (true) {
          const index = cursor++;
          if (index >= targets.length) return;
          try { roundSamples.push(await request('poll', targets[index])); }
          catch (error) { failures.push(String(error?.message || error).slice(0, 180)); }
        }
      });
      const started = performance.now();
      await Promise.all(workers);
      samples.push(...roundSamples);
      console.log(JSON.stringify({ round: round + 1, requests: targets.length, elapsed_ms: Number((performance.now() - started).toFixed(1)), successful: roundSamples.length, failures: targets.length - roundSamples.length }));
    }
    console.log(JSON.stringify({
      target: { host: new URL(base).hostname, database: dbName },
      workload: 'public widget config preflight and read-only visitor polling over seeded synthetic chats',
      note: 'Visitor polls refresh last_visitor_seen_at subject to the 15-second heartbeat throttle. No messages or tickets are created.',
      profile, workspaces: targets.length, concurrency: settings.concurrency,
      config: { requests: configSamples.length, ...percentileStats(configSamples) },
      warmup: { requests: warmup.length, failures: warmupFailures },
      measured: { rounds: settings.rounds, requests: samples.length + failures.length, failures: failures.length, requests_per_second: Number(((samples.length + failures.length) / (samples.reduce((a,b)=>a+b,0) / 1000 || 1)).toFixed(1)), ...percentileStats(samples) },
      failure_samples: failures.slice(0, 5)
    }, null, 2));
    if (warmupFailures || failures.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error?.message || error); process.exitCode = 1; });
}
