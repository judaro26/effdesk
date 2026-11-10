// src/presence.js: COLLISIONS. An open ticket tells the server every ~20 seconds that its agent is there (and whether they are typing); the answer lists the others who were there in the last 45 seconds.
//   Sending a reply checks that nothing new arrived since the agent last looked; if something did, the agent is asked before it goes out.
import { withOrg } from './db.js';
const FRESH = 45;
export async function heartbeat(pool, orgId, actor, number, typing) {
  return withOrg(pool, orgId, async c => {
    const t = (await c.query('select id from tickets where org_id = $1 and number = $2', [orgId, Number(number) || 0])).rows[0]; if (!t) return { ok: false, status: 404, error: 'No such ticket.' };
    await c.query('insert into ticket_presence (org_id, ticket_id, user_id, name, typing, seen_at) values ($1,$2,$3,$4,$5,now()) on conflict (ticket_id, user_id) do update set name = $4, typing = $5, seen_at = now()', [orgId, t.id, actor.id, String(actor.name || actor.email || '').slice(0, 100), typing === true]);
    await c.query("delete from ticket_presence where org_id = $1 and seen_at < now() - interval '5 minutes'", [orgId]);
    const others = (await c.query(`select user_id, name, typing from ticket_presence where org_id = $1 and ticket_id = $2 and user_id <> $3 and seen_at > now() - interval '${FRESH} seconds' order by name`, [orgId, t.id, actor.id])).rows;
    return { ok: true, others: others.map(o => ({ userId: o.user_id, name: o.name, typing: o.typing })) };
  });
}
export const leave = async (pool, orgId, actor, number) => withOrg(pool, orgId, c => c.query('delete from ticket_presence where org_id = $1 and user_id = $2 and ticket_id in (select id from tickets where org_id = $1 and number = $3)', [orgId, actor.id, Number(number) || 0]));
// messages from the customer or another agent that the agent has not seen (their id is above the last one on the agent's screen)
export async function newSince(pool, orgId, actorId, number, seenId) {
  if (!seenId) return [];
  return withOrg(pool, orgId, async c => (await c.query(`select m.id, m.kind, m.author_name, m.created_at from ticket_messages m join tickets t on t.id = m.ticket_id where t.org_id = $1 and t.number = $2 and m.id > $3 and m.kind in ('requester','agent') and (m.author_id is distinct from $4) order by m.id`, [orgId, Number(number) || 0, Number(seenId) || 0, actorId])).rows);
}
// the same agent sent the same text on this ticket moments ago (a double click or a retry while the first send was still running)
export async function recentDuplicate(pool, orgId, actorId, number, body, seconds = 30) {
  return withOrg(pool, orgId, async c => (await c.query(`select m.id from ticket_messages m join tickets t on t.id = m.ticket_id where t.org_id = $1 and t.number = $2 and m.kind = 'agent' and m.author_id = $3 and m.body = $4 and m.created_at > now() - ($5 || ' seconds')::interval limit 1`, [orgId, Number(number) || 0, actorId, String(body || ''), String(seconds)])).rows.length > 0);
}
