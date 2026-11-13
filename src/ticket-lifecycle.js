// src/ticket-lifecycle.js: tenant-scoped lifecycle policies and idempotent scheduled actions.
import { withOrg } from './db.js';
import { updateTicket } from './tickets.js';
import { sendTicketReply } from './ticket-mail.js';
import { notifyTicket } from './notify.js';

export const DEFAULT_LIFECYCLE = Object.freeze({
  autoCloseEnabled: false, autoCloseDays: 4,
  customerReminderEnabled: false, customerReminderHours: 48, customerReminderRepeatHours: 72,
  agentReminderEnabled: false, agentReminderHours: 24, agentReminderRepeatHours: 48,
  reopenEnabled: false, reopenAfterDays: 14,
  permanentCloseEnabled: false, permanentCloseDays: 30
});
const bounded = (v, fallback, min, max) => Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? Number(v) : fallback;
export function normalizeLifecycle(input = {}) {
  const c = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {
    autoCloseEnabled: c.autoCloseEnabled === true, autoCloseDays: bounded(c.autoCloseDays, DEFAULT_LIFECYCLE.autoCloseDays, 1, 365),
    customerReminderEnabled: c.customerReminderEnabled === true, customerReminderHours: bounded(c.customerReminderHours, DEFAULT_LIFECYCLE.customerReminderHours, 1, 8760), customerReminderRepeatHours: bounded(c.customerReminderRepeatHours, DEFAULT_LIFECYCLE.customerReminderRepeatHours, 1, 8760),
    agentReminderEnabled: c.agentReminderEnabled === true, agentReminderHours: bounded(c.agentReminderHours, DEFAULT_LIFECYCLE.agentReminderHours, 1, 8760), agentReminderRepeatHours: bounded(c.agentReminderRepeatHours, DEFAULT_LIFECYCLE.agentReminderRepeatHours, 1, 8760),
    reopenEnabled: c.reopenEnabled === true, reopenAfterDays: bounded(c.reopenAfterDays, DEFAULT_LIFECYCLE.reopenAfterDays, 1, 365),
    permanentCloseEnabled: c.permanentCloseEnabled === true, permanentCloseDays: bounded(c.permanentCloseDays, DEFAULT_LIFECYCLE.permanentCloseDays, 1, 3650)
  };
  return out;
}
export async function getLifecyclePolicy(pool, orgId) {
  return withOrg(pool, orgId, async c => {
    const row = (await c.query('select config, updated_at from ticket_lifecycle_policies where org_id=$1', [orgId])).rows[0];
    return { ok: true, policy: { ...DEFAULT_LIFECYCLE, ...(row?.config || {}) }, updatedAt: row?.updated_at || null };
  });
}
export async function saveLifecyclePolicy(pool, orgId, input, actorId) {
  const policy = normalizeLifecycle(input);
  if (policy.error) return { ok: false, status: 400, error: policy.error };
  return withOrg(pool, orgId, async c => {
    await c.query('insert into ticket_lifecycle_policies(org_id,config,updated_by,updated_at) values($1,$2,$3,now()) on conflict(org_id) do update set config=excluded.config,updated_by=excluded.updated_by,updated_at=now()', [orgId, JSON.stringify(policy), actorId || null]);
    return { ok: true, policy };
  });
}
async function claim(pool, orgId, ticketId, key, detail = {}) {
  return withOrg(pool, orgId, async c => (await c.query('insert into ticket_lifecycle_runs(org_id,ticket_id,action_key,detail) values($1,$2,$3,$4) on conflict do nothing returning ticket_id', [orgId,ticketId,key,JSON.stringify(detail)])).rowCount === 1);
}
async function act(pool, orgId, t, key, action, detail = {}) {
  if (!(await claim(pool,orgId,t.id,key,detail))) return false;
  try { await action(); return true; }
  catch (e) { await withOrg(pool,orgId,c=>c.query('delete from ticket_lifecycle_runs where org_id=$1 and ticket_id=$2 and action_key=$3',[orgId,t.id,key])); throw e; }
}
async function lifecycleMessage(pool, orgId, ticketId, body, internal) {
  return withOrg(pool,orgId,async c=>{
    const kind=internal?'note':'agent';
    const m=(await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body) values($1,$2,$3,null,$4,$5) returning id',[orgId,ticketId,kind,'Ticket lifecycle automation',body])).rows[0];
    await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,$4,$5)',[orgId,ticketId,'Ticket lifecycle automation',internal?'note':'reminder',internal?'Internal agent reminder sent':'Customer reminder sent']);
    return m;
  });
}
const hoursSince = (v, now) => v ? Math.max(0,(now-new Date(v).getTime())/3600000) : 0;
export async function runTicketLifecycle(pool, mailer, env = process.env, nowMs = Date.now()) {
  let actions = 0, errors = 0;
  const orgs = (await pool.query('select id from "organization"')).rows;
  for (const {id:orgId} of orgs) {
    try {
      const policyResult = await getLifecyclePolicy(pool,orgId), p = policyResult.policy;
      if (!Object.values(p).some(v => v === true)) continue;
      const rows = await withOrg(pool,orgId,c=>c.query(`select t.id,t.number,t.subject,t.status,t.priority,t.requester_name,t.requester_email,t.assignee_id,t.solved_at,t.closed_at,t.created_at,t.updated_at,
        (select max(m.created_at) from ticket_messages m where m.org_id=t.org_id and m.ticket_id=t.id and m.kind='requester') as last_customer_at
        from tickets t where org_id=$1 and status in ('open','pending','on_hold','solved','closed')
        and updated_at < now() - interval '1 hour' order by updated_at limit 1000`,[orgId]));
      for (const t of rows.rows) {
        try {
          const idle = hoursSince(t.updated_at,nowMs), customerIdle = hoursSince(t.last_customer_at || t.created_at || t.updated_at,nowMs), solvedAge = hoursSince(t.solved_at,nowMs), closedAge = hoursSince(t.closed_at || t.updated_at,nowMs);
          if (['pending','on_hold'].includes(t.status) && p.reopenEnabled && idle >= p.reopenAfterDays*24) {
            if (await act(pool,orgId,t,'reopen-after-idle-'+new Date(t.updated_at).toISOString(),async()=>{const r=await updateTicket(pool,orgId,{id:null,name:'Ticket lifecycle automation'},t.number,{status:'open'});if(!r.ok)throw new Error(r.error||'Unable to reopen ticket');})) actions++;
            continue;
          }
          if (t.status === 'solved' && p.autoCloseEnabled && solvedAge >= p.autoCloseDays*24) {
            if (await act(pool,orgId,t,'auto-close-solved-'+new Date(t.solved_at).toISOString(),async()=>{const r=await updateTicket(pool,orgId,{id:null,name:'Ticket lifecycle automation'},t.number,{status:'closed'});if(!r.ok)throw new Error(r.error||'Unable to close ticket');})) actions++;
            continue;
          }
          if (t.status === 'pending' && p.customerReminderEnabled && customerIdle >= p.customerReminderHours) {
            const interval = p.customerReminderRepeatHours, bucket = Math.floor((customerIdle-p.customerReminderHours)/interval);
            const key = 'customer-reminder-'+String(t.last_customer_at || t.updated_at)+'-'+bucket;
            if (await act(pool,orgId,t,key,async()=>{
              const body='We are waiting for your response on this request. Reply to this email if you still need help.';
              const msg=await lifecycleMessage(pool,orgId,t.id,body,false);
              if(mailer)await sendTicketReply(pool,mailer,env,orgId,t.number,msg.id,[]);
            },{bucket})) actions++;
          }
          if (['open','on_hold'].includes(t.status) && p.agentReminderEnabled && idle >= p.agentReminderHours) {
            const interval=p.agentReminderRepeatHours,bucket=Math.floor((idle-p.agentReminderHours)/interval),key='agent-reminder-'+new Date(t.updated_at).toISOString()+'-'+bucket;
            if(await act(pool,orgId,t,key,async()=>{
              const body='Automation reminder: this ticket has had no activity for '+Math.round(idle)+' hours. Please review ownership and next steps.';
              await lifecycleMessage(pool,orgId,t.id,body,true);
              await notifyTicket(pool,mailer,orgId,t.number,{kind:'ticket_reminder',summary:'This ticket has had no activity for '+Math.round(idle)+' hours. Please review it.'});
            },{bucket})) actions++;
          }
        } catch(e) { errors++; console.warn('ticket lifecycle action failed',orgId,t.number,e.message); }
      }
    } catch(e) { errors++; console.warn('ticket lifecycle workspace failed',orgId,e.message); }
  }
  return { actions, errors };
}
