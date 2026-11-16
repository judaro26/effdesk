// src/notification-jobs.js: durable delivery for agent ticket notices and CSAT surveys.
import { withOrg } from './db.js';
import { PRODUCT } from './config.js';
import { csatToken } from './csat.js';

export async function deliverAgentNoticeJob(pool, mailer, orgId, payload, job = {}) {
  const number = Number(payload?.number), userId = String(payload?.userId || '');
  const kind = String(payload?.kind || 'reply').slice(0, 80);
  if (!Number.isSafeInteger(number) || number < 1 || !userId) throw new Error('Agent notice job is missing its recipient or ticket reference.');
  const data = await withOrg(pool, orgId, async c => (await c.query(`
    select t.subject, t.assignee_id, o.name as org_name, u.email,
      coalesce(p.notify, true) as notify,
      exists(select 1 from ticket_followers f where f.org_id=t.org_id and f.ticket_id=t.id and f.user_id=u.id) as follows
    from tickets t
    join "organization" o on o.id=t.org_id
    join member m on m."organizationId"=t.org_id and m."userId"=$3
    join "user" u on u.id=m."userId"
    left join desk_prefs p on p.user_id=u.id
    where t.org_id=$1 and t.number=$2
  `, [orgId, number, userId])).rows[0] || null);
  if (!data || !data.email || data.notify !== true) return { skipped: true };
  if (kind === 'assigned' ? data.assignee_id !== userId : data.assignee_id !== userId && data.follows !== true) return { skipped: true };
  if (!mailer || typeof mailer.agentNotice !== 'function') throw new Error('Agent notice mailer is unavailable.');
  await mailer.agentNotice(data.email, {
    kind, orgName: data.org_name, number, subject: data.subject,
    summary: String(payload.summary || '').slice(0, 300),
    url: PRODUCT.appUrl + '/desk.html?org=' + encodeURIComponent(orgId) + '&ticket=' + number,
    idempotencyKey: 'agent-notice-job:' + String(job.id || '')
  });
  return { sent: true };
}

export async function deliverCsatSurveyJob(pool, mailer, env, orgId, payload, job = {}) {
  const number = Number(payload?.number);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error('CSAT survey job is missing its ticket reference.');
  const data = await withOrg(pool, orgId, async c => {
    const ticket = (await c.query('select id, number, subject, requester_email, requester_name from tickets where org_id=$1 and number=$2', [orgId, number])).rows[0];
    if (!ticket || !ticket.requester_email) return null;
    const org = (await c.query('select name, slug from "organization" where id=$1', [orgId])).rows[0];
    return org ? { ticket, org } : null;
  });
  if (!data) return { skipped: true };
  if (!mailer || typeof mailer.csat !== 'function') throw new Error('CSAT mailer is unavailable.');
  const base = String(payload.portal || (PRODUCT.appUrl + '/help/' + data.org.slug));
  const link = rating => base + '/csat/' + data.ticket.number + '?t=' + csatToken(env, orgId, data.ticket.number) + '&r=' + rating;
  await mailer.csat(data.ticket.requester_email, {
    orgName: data.org.name, number: data.ticket.number, subject: data.ticket.subject,
    name: String(data.ticket.requester_name || '').split(' ')[0],
    good: link('good'), bad: link('bad'),
    idempotencyKey: 'csat-survey-job:' + String(job.id || '')
  });
  return { sent: true };
}
