// src/jobs.js: tenant-scoped durable outbox with SKIP LOCKED claims and retryable leases.
import crypto from 'node:crypto';
import { withOrg } from './db.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;

export async function enqueueJob(pool, orgId, { type, payload = {}, idempotencyKey, maxAttempts = 8, runAt = new Date() } = {}) {
  const jobType = String(type || '').trim(), key = String(idempotencyKey || '');
  if (!/^[a-z][a-z0-9._-]{0,99}$/i.test(jobType)) throw new Error('A valid background job type is required.');
  if (!key || key.length > 200) throw new Error('A background job idempotency key is required.');
  const attempts = Math.max(1, Math.min(20, Number(maxAttempts) || 8));
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Background job payload exceeds 256 KB.');
  const due = new Date(runAt);
  if (!Number.isFinite(due.getTime())) throw new Error('Background job run time is invalid.');
  return withOrg(pool, orgId, async db => {
    const inserted = await db.query(
      'insert into background_jobs (org_id, job_type, payload, idempotency_key, max_attempts, run_at) values ($1,$2,$3::jsonb,$4,$5,$6) on conflict (org_id,job_type,idempotency_key) do nothing returning id,status',
      [orgId, jobType, body, key, attempts, due.toISOString()]
    );
    if (inserted.rowCount) return { id: String(inserted.rows[0].id), created: true, status: inserted.rows[0].status };
    const prior = (await db.query('select id,status from background_jobs where org_id=$1 and job_type=$2 and idempotency_key=$3', [orgId, jobType, key])).rows[0];
    return prior ? { id: String(prior.id), created: false, status: prior.status } : { id: null, created: false, status: 'unknown' };
  });
}

export async function claimJobs(pool, orgId, workerId = crypto.randomUUID(), { limit = 10, now = Date.now(), leaseMs = 120000 } = {}) {
  const take = Math.max(1, Math.min(100, Number(limit) || 10));
  const current = new Date(now), leaseBefore = new Date(current.getTime() - Math.max(1000, Number(leaseMs) || 120000));
  return withOrg(pool, orgId, async db => {
    await db.query(
      "update background_jobs set status='failed', locked_at=null, locked_by=null, last_error=coalesce(last_error,'Worker lease expired after the final attempt'), updated_at=$2 where org_id=$1 and status='running' and locked_at <= $3 and attempts >= max_attempts",
      [orgId, current.toISOString(), leaseBefore.toISOString()]
    );
    const result = await db.query(
      `with due as (
         select id from background_jobs
         where org_id=$1 and attempts < max_attempts
           and ((status='queued' and run_at <= $2) or (status='running' and locked_at <= $3))
         order by run_at,id
         limit $4
         for update skip locked
       )
       update background_jobs j
       set status='running', attempts=j.attempts+1, locked_at=$2, locked_by=$5, updated_at=$2
       from due where j.org_id=$1 and j.id=due.id
       returning j.id,j.org_id,j.job_type,j.payload,j.idempotency_key,j.attempts,j.max_attempts`,
      [orgId, current.toISOString(), leaseBefore.toISOString(), take, String(workerId)]
    );
    return result.rows.map(row => ({ ...row, id: String(row.id) }));
  });
}

export async function completeJob(pool, orgId, jobId, workerId) {
  return withOrg(pool, orgId, async db => (await db.query(
    "update background_jobs set status='succeeded', locked_at=null, locked_by=null, last_error=null, updated_at=now() where org_id=$1 and id=$2 and status='running' and locked_by=$3",
    [orgId, jobId, String(workerId)]
  )).rowCount === 1);
}

export async function failJob(pool, orgId, jobId, workerId, error, { retryDelayMs } = {}) {
  return withOrg(pool, orgId, async db => {
    const prior = (await db.query("select attempts,max_attempts from background_jobs where org_id=$1 and id=$2 and status='running' and locked_by=$3 for update", [orgId, jobId, String(workerId)])).rows[0];
    if (!prior) return { updated: false, status: 'stale' };
    const terminal = Number(prior.attempts) >= Number(prior.max_attempts);
    const delay = Number.isFinite(Number(retryDelayMs)) ? Math.max(0, Number(retryDelayMs)) : Math.min(3600000, 5000 * (2 ** Math.max(0, Number(prior.attempts) - 1)));
    const result = await db.query(
      "update background_jobs set status=$4, run_at=case when $4='queued' then now()+($5::int * interval '1 millisecond') else run_at end, locked_at=null, locked_by=null, last_error=$6, updated_at=now() where org_id=$1 and id=$2 and status='running' and locked_by=$3 returning status,attempts",
      [orgId, jobId, String(workerId), terminal ? 'failed' : 'queued', Math.min(3600000, delay), String(error && error.message || error || 'Unknown background job error').slice(0, 2000)]
    );
    return result.rows[0] ? { updated: true, status: result.rows[0].status, attempts: result.rows[0].attempts } : { updated: false, status: 'stale' };
  });
}

export async function runJobs(pool, handlers, { batchSize = 20, workerId = crypto.randomUUID(), leaseMs = 120000 } = {}) {
  const take = Math.max(1, Math.min(100, Number(batchSize) || 20));
  const organizations = (await pool.query('select id from "organization" order by id')).rows;
  const summary = { claimed: 0, succeeded: 0, retried: 0, failed: 0 };
  for (const organization of organizations) {
    if (summary.claimed >= take) break;
    const jobs = await claimJobs(pool, String(organization.id), workerId, { limit: take - summary.claimed, leaseMs });
    summary.claimed += jobs.length;
    for (const job of jobs) {
      try {
        const handler = handlers && handlers[job.job_type];
        if (typeof handler !== 'function') throw new Error('No worker is registered for job type ' + job.job_type);
        await handler(String(job.org_id), job.payload, job);
        if (await completeJob(pool, String(job.org_id), job.id, workerId)) summary.succeeded++;
      } catch (error) {
        const result = await failJob(pool, String(job.org_id), job.id, workerId, error);
        if (result.status === 'queued') summary.retried++;
        else if (result.status === 'failed') summary.failed++;
      }
    }
  }
  return summary;
}
