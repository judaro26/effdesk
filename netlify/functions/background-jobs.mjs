// netlify/functions/background-jobs.mjs
// Netlify invokes this scheduled worker every minute. Jobs are claimed with
// PostgreSQL SKIP LOCKED leases, so overlapping invocations cannot own the same job.
import { context } from '../../src/context.js';
import { runJobs } from '../../src/jobs.js';
import { deliverWebhook } from '../../src/webhooks.js';
import { deliverTicketEmailJob } from '../../src/ticket-mail-jobs.js';
import { deliverChatEmailJob } from '../../src/chat-mail-jobs.js';
import { deliverAgentNoticeJob, deliverCsatSurveyJob } from '../../src/notification-jobs.js';

export default async function backgroundJobs() {
  const { pool, mailer, store } = context();
  const summary = await runJobs(pool, {
    'webhook.deliver': (orgId, payload) => deliverWebhook(pool, orgId, payload),
    'ticket.email.deliver': (orgId, payload, job) => deliverTicketEmailJob(pool, mailer, store, process.env, orgId, payload, job),
    'chat.email.deliver': (orgId, payload, job) => deliverChatEmailJob(pool, mailer, orgId, payload, job),
    'email.agent_notice': (orgId, payload, job) => deliverAgentNoticeJob(pool, mailer, orgId, payload, job),
    'email.csat_survey': (orgId, payload, job) => deliverCsatSurveyJob(pool, mailer, process.env, orgId, payload, job)
  }, { batchSize: Math.max(1, Math.min(50, Number(process.env.BACKGROUND_JOB_BATCH_SIZE) || 10)), leaseMs: 120000 });
  return new Response(JSON.stringify({ ok: true, ...summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

export const config = { schedule: '*/1 * * * *' };
