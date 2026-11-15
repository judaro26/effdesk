// netlify/functions/background-jobs.mjs
// Netlify invokes this scheduled worker every minute. Jobs are claimed with
// PostgreSQL SKIP LOCKED leases, so overlapping invocations cannot own the same job.
import { context } from '../../src/context.js';
import { runJobs } from '../../src/jobs.js';
import { deliverWebhook } from '../../src/webhooks.js';

export default async function backgroundJobs() {
  const { pool } = context();
  const summary = await runJobs(pool, {
    'webhook.deliver': (orgId, payload) => deliverWebhook(pool, orgId, payload)
  }, { batchSize: 25, leaseMs: 120000 });
  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export const config = { schedule: '*/1 * * * *' };
