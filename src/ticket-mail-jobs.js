// src/ticket-mail-jobs.js: background delivery for customer-facing ticket replies.
import { withOrg } from './db.js';
import { filesOfMessage, readFile } from './attachments.js';
import { sendTicketReply } from './ticket-mail.js';

export async function deliverTicketEmailJob(pool, mailer, store, env, orgId, payload, job = {}) {
  const number = Number(payload?.number), messageRowId = String(payload?.messageRowId || '');
  if (!Number.isSafeInteger(number) || number < 1 || !messageRowId) throw new Error('Ticket email job is missing its ticket or message reference.');
  const files = [];
  if (store) {
    const rows = await filesOfMessage(pool, orgId, messageRowId);
    for (const row of rows) {
      const file = await readFile(pool, store, orgId, row.id);
      if (file) files.push(file);
    }
  }
  const result = await sendTicketReply(pool, mailer, env, orgId, number, messageRowId, files, {
    idempotencyKey: 'ticket-message:' + messageRowId
  });
  if (result.delivery === 'failed') {
    const delivery = Number(job.attempts) >= Number(job.max_attempts) ? 'failed' : 'queued';
    await withOrg(pool, orgId, c => c.query(
      'update ticket_messages set delivery = $3 where org_id = $1 and id = $2',
      [orgId, messageRowId, delivery]
    ));
    throw new Error('Ticket email delivery failed; the background worker will retry.');
  }
  return result;
}
