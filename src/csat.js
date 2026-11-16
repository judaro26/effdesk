// src/csat.js: CUSTOMER SATISFACTION. When a ticket is solved, the requester gets one email (once per ticket, ever) with a link to a small page: good or bad, and an optional comment.
// The link carries a signature, so only the person who got the email can rate; opening the link rates nothing (mail scanners open links), the person presses the button on the page.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { PRODUCT } from './config.js';
import { enqueueJob } from './jobs.js';
export const csatToken = (env, orgId, number) => crypto.createHmac('sha256', String(env.BETTER_AUTH_SECRET || '')).update(`csat:${orgId}:${number}`).digest('base64url').slice(0, 22);
export const tokenOk = (env, orgId, number, t) => { const a = Buffer.from(csatToken(env, orgId, number)), b = Buffer.from(String(t || '')); return !!env.BETTER_AUTH_SECRET && a.length === b.length && crypto.timingSafeEqual(a, b); };
export const csatOn = async (pool, orgId) => withOrg(pool, orgId, async c => ((await c.query('select csat_on from org_settings where org_id = $1', [orgId])).rows[0] || { csat_on: true }).csat_on);
export const setCsatOn = (pool, orgId, on) => withOrg(pool, orgId, c => c.query('insert into org_settings (org_id, csat_on) values ($1,$2) on conflict (org_id) do update set csat_on = $2', [orgId, !!on]));
// after a ticket becomes solved: ask for a rating (never twice for one ticket)
export async function surveyIfSolved(pool, mailer, env, orgId, number, { portal = '' } = {}) {
  if (!mailer || !mailer.csat) return { sent: false, queued: false };
  try {
    if (!(await csatOn(pool, orgId))) return { sent: false, queued: false };
    const data = await withOrg(pool, orgId, async c => {
      const ticket = (await c.query("select id, number, status, requester_email from tickets where org_id = $1 and number = $2", [orgId, Number(number) || 0])).rows[0];
      if (!ticket || ticket.status !== 'solved' || !ticket.requester_email) return null;
      const fresh = (await c.query('insert into csat_ratings (ticket_id, org_id) values ($1,$2) on conflict do nothing returning 1', [ticket.id, orgId])).rowCount;
      return fresh ? ticket : null;
    });
    if (!data) return { sent: false, queued: false };
    const job = await enqueueJob(pool, orgId, {
      type: 'email.csat_survey',
      payload: { number: Number(data.number), ...(portal ? { portal: String(portal).slice(0, 1000) } : {}) },
      idempotencyKey: 'csat-ticket:' + String(data.id),
      maxAttempts: 8
    });
    return { sent: false, queued: !['failed', 'succeeded'].includes(job.status), jobId: job.id || null };
  } catch (e) { console.warn('csat queue error:', e.message); return { sent: false, queued: false }; }
}
export async function rate(pool, orgId, number, rating, comment) {
  const val = rating === 'good' ? 1 : rating === 'bad' ? 0 : null; if (val === null) return false;
  const text = String(comment || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 1000);
  return withOrg(pool, orgId, async c => (await c.query('update csat_ratings set rating = $3, comment = $4, rated_at = now() where org_id = $1 and ticket_id = (select id from tickets where org_id = $1 and number = $2)', [orgId, Number(number) || 0, val, text])).rowCount > 0);
}
export async function ratingOf(pool, orgId, number) {
  return withOrg(pool, orgId, async c => { const r = (await c.query('select r.rating, r.comment, r.rated_at from csat_ratings r join tickets t on t.id = r.ticket_id where r.org_id = $1 and t.number = $2', [orgId, Number(number) || 0])).rows[0]; return r && r.rating !== null ? { good: r.rating === 1, comment: r.comment, ratedAt: r.rated_at } : null; });
}
