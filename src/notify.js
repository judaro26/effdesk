// src/notify.js: EMAIL TO AGENTS. People who follow a ticket, and its assignee, get an email when the customer (or the person in a side conversation) replies; a person gets one when a ticket is assigned to them. Each person can switch it off in their profile; one ticket sends a person at most one reply email per 10 minutes; the person who caused the event is never told about it. Never throws: the reply itself is already saved.
import { withOrg } from './db.js';
import { PRODUCT } from './config.js';

const DEDUPE_MINUTES = 10;
export async function notifyTicket(pool, mailer, orgId, number, { kind, actorId = null, onlyUserId = null, summary = '' }) {
  if (!mailer || !mailer.agentNotice) return { sent: 0 };
  try {
    const data = await withOrg(pool, orgId, async c => {
      const t = (await c.query('select id, subject, assignee_id from tickets where org_id = $1 and number = $2', [orgId, Number(number) || 0])).rows[0]; if (!t) return null;
      const org = (await c.query('select name from "organization" where id = $1', [orgId])).rows[0];
      const ids = onlyUserId ? [onlyUserId] : [...new Set([t.assignee_id, ...(await c.query('select user_id from ticket_followers where org_id = $1 and ticket_id = $2', [orgId, t.id])).rows.map(r => r.user_id)].filter(Boolean))];
      return { t, orgName: org ? org.name : '', ids: ids.filter(i => i !== actorId) };
    });
    if (!data || !data.ids.length) return { sent: 0 };
    // only people who are still members and have not switched notifications off
    const people = (await pool.query(`select u.id, u.email, coalesce(p.notify, true) notify from "user" u join member m on m."userId" = u.id and m."organizationId" = $1 left join desk_prefs p on p.user_id = u.id where u.id = any($2)`, [orgId, data.ids])).rows.filter(p => p.notify);
    let sent = 0;
    for (const p of people) {
      if (kind !== 'assigned') {
        const hit = (await pool.query(`insert into desk_notify_log (user_id, ticket_id) values ($1,$2) on conflict (user_id, ticket_id) do update set notified_at = now() where desk_notify_log.notified_at < now() - interval '${DEDUPE_MINUTES} minutes' returning 1`, [p.id, data.t.id])).rowCount;
        if (!hit) continue;
      }
      try { await mailer.agentNotice(p.email, { kind, orgName: data.orgName, number, subject: data.t.subject, summary: String(summary || '').slice(0, 300), url: `${PRODUCT.appUrl}/desk.html?org=${encodeURIComponent(orgId)}&ticket=${Number(number)}` }); sent++; } catch (e) { console.warn('agent notice failed:', e.message); }
    }
    return { sent };
  } catch (e) { console.warn('notify error:', e.message); return { sent: 0 }; }
}
