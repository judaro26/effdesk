// scripts/test-background-jobs.js: durable outbox claims, leases, retries, tenant isolation and webhook delivery.
import crypto from 'node:crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { withOrg } from '../src/db.js';
import { enqueueJob, claimJobs, completeJob, failJob, renewJobLease, runJobs } from '../src/jobs.js';
import { deliverWebhook } from '../src/webhooks.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const { url } = await freshDb('backgroundjobs'); await migrate(url);
const pool = makePool(url), mailer = makeMailer({ transport: async () => {} });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => {
  await auth.api.signUpEmail({ body: { email, password: PW, name } });
  const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true });
  const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; ');
  return { headers: new Headers({ cookie }), user: r.response.user };
};
const owner = await signUp('owner@jobs.test', 'Owner'), other = await signUp('other@jobs.test', 'Other');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'jobs-acme' }, headers: owner.headers });
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'jobs-beta' }, headers: other.headers });

const first = await enqueueJob(pool, acme.id, { type: 'test.once', payload: { value: 1 }, idempotencyKey: 'event-1' });
const duplicate = await enqueueJob(pool, acme.id, { type: 'test.once', payload: { value: 2 }, idempotencyKey: 'event-1' });
check('enqueue is idempotent within an organization and job type', first.created && !duplicate.created && first.id === duplicate.id);

const workerA = 'worker-a', workerB = 'worker-b';
const claimed = await claimJobs(pool, acme.id, workerA, { limit: 1 });
check('a worker atomically claims a queued job and increments its attempt count', claimed.length === 1 && claimed[0].id === first.id && claimed[0].attempts === 1 && claimed[0].payload.value === 1);
check('a second worker cannot claim a job while its lease is active', (await claimJobs(pool, acme.id, workerB, { limit: 1 })).length === 0);
check('only the current lease owner can complete a job', !(await completeJob(pool, acme.id, first.id, workerB)) && await completeJob(pool, acme.id, first.id, workerA));

const retry = await enqueueJob(pool, acme.id, { type: 'test.retry', payload: {}, idempotencyKey: 'event-retry', maxAttempts: 2 });
const retryOne = (await claimJobs(pool, acme.id, workerA, { limit: 1 })).find(x => x.id === retry.id);
const failedOnce = await failJob(pool, acme.id, retry.id, workerA, new Error('temporary provider outage'), { retryDelayMs: 0 });
const retryTwo = (await claimJobs(pool, acme.id, workerB, { limit: 5 })).find(x => x.id === retry.id);
const failedFinal = await failJob(pool, acme.id, retry.id, workerB, new Error('provider still unavailable'), { retryDelayMs: 0 });
check('failed jobs are rescheduled and become terminal after the configured attempt limit', !!retryOne && failedOnce.status === 'queued' && !!retryTwo && retryTwo.attempts === 2 && failedFinal.status === 'failed');

const leased = await enqueueJob(pool, acme.id, { type: 'test.lease', payload: {}, idempotencyKey: 'lease-recovery' });
const leaseStart = Date.now();
const oldLease = await claimJobs(pool, acme.id, workerA, { limit: 1, now: leaseStart, leaseMs: 1000 });
const renewed = await renewJobLease(pool, acme.id, leased.id, workerA, { now: leaseStart + 500 });
const prematureRecovery = await claimJobs(pool, acme.id, workerB, { limit: 1, now: leaseStart + 1400, leaseMs: 1000 });
const recovered = await claimJobs(pool, acme.id, workerB, { limit: 1, now: leaseStart + 1600, leaseMs: 1000 });
check('a live worker can extend its lease and prevent premature reclamation', oldLease.some(x => x.id === leased.id) && renewed && !prematureRecovery.some(x => x.id === leased.id));
check('a stale worker cannot renew a reclaimed lease and cannot complete its job', recovered.some(x => x.id === leased.id) && !(await renewJobLease(pool, acme.id, leased.id, workerA)) && !(await completeJob(pool, acme.id, leased.id, workerA)) && await completeJob(pool, acme.id, leased.id, workerB));

const tenantJob = await enqueueJob(pool, acme.id, { type: 'test.tenant', payload: {}, idempotencyKey: 'tenant-only' });
check('a different organization cannot claim another tenant\'s jobs', (await claimJobs(pool, beta.id, workerB, { limit: 10 })).length === 0);
await failJob(pool, acme.id, tenantJob.id, workerA, new Error('test cleanup'), { retryDelayMs: 0 }).catch(() => {});

const hookSecret = 'whsec_test_secret', hook = (await withOrg(pool, acme.id, db => db.query(
  "insert into webhooks(org_id,url,secret,events,kind) values($1,$2,$3,$4,'json') returning id",
  [acme.id, 'https://hooks.example.com/effdesk', hookSecret, ['ticket.updated']]
))).rows[0];
const webhookPayload = { webhookId: String(hook.id), event: 'ticket.updated', eventId: 'event-signature-check', body: JSON.stringify({ eventId: 'event-signature-check', event: 'ticket.updated' }), text: 'Ticket updated' };
let captured = null;
const delivered = await deliverWebhook(pool, acme.id, webhookPayload, { now: 1700000000000, fetchFn: async (url, options) => { captured = { url, options }; return { ok: true, status: 204 }; } });
const expectedSignature = 'sha256=' + crypto.createHmac('sha256', hookSecret).update('1700000000.' + webhookPayload.body).digest('hex');
check('webhook jobs deliver the stored event with a fresh timestamp and valid HMAC signature', delivered.delivered && captured.url === 'https://hooks.example.com/effdesk' && captured.options.headers['X-EffDesk-Event-Id'] === webhookPayload.eventId && captured.options.headers['X-EffDesk-Signature'] === expectedSignature);
let failedDelivery = false;
try { await deliverWebhook(pool, acme.id, webhookPayload, { fetchFn: async () => ({ ok: false, status: 503 }) }); } catch { failedDelivery = true; }
const lastStatus = (await withOrg(pool, acme.id, db => db.query('select last_status from webhooks where org_id=$1 and id=$2', [acme.id, hook.id]))).rows[0].last_status;
check('non-success webhook responses are surfaced for retry and recorded for operators', failedDelivery && lastStatus === '503');

const workerJob = await enqueueJob(pool, acme.id, { type: 'test.worker', payload: { ok: true }, idempotencyKey: 'worker-dispatch' });
let handled = 0;
const run = await runJobs(pool, { 'test.worker': async (orgId, payload) => { if (orgId === acme.id && payload.ok) handled++; } }, { batchSize: 5 });
const workerStatus = (await withOrg(pool, acme.id, db => db.query('select status from background_jobs where org_id=$1 and id=$2', [acme.id, workerJob.id]))).rows[0].status;
check('the scheduled worker dispatches registered job types and marks successful work complete', handled === 1 && run.succeeded === 1 && workerStatus === 'succeeded');

// Tenant fairness: a noisy workspace must not take the entire worker batch.
await pool.query("update background_jobs set status='failed', locked_at=null, locked_by=null where status in ('queued','running')");
for (let i = 0; i < 3; i++) {
  await enqueueJob(pool, acme.id, { type: 'test.fairness', payload: { tenant: acme.id }, idempotencyKey: 'acme-' + i });
  await enqueueJob(pool, beta.id, { type: 'test.fairness', payload: { tenant: beta.id }, idempotencyKey: 'beta-' + i });
}
const fairnessTenants = [];
const fairness = await runJobs(pool, { 'test.fairness': async orgId => { fairnessTenants.push(orgId); } }, { batchSize: 2, workerId: 'fair-worker' });
check('the worker gives separate tenants a turn before taking a second job from a busy tenant', fairness.claimed === 2 && new Set(fairnessTenants).size === 2 && fairness.tenantsProcessed === 2 && fairness.maxJobsPerTenant === 1);
check('worker run summaries expose tenant coverage and per-tenant batch concentration', fairness.organizationsVisited >= 2 && fairness.succeeded === 2);

await pool.end(); done();
