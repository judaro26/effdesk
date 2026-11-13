// Hourly, tenant-scoped approval reminders. Failed recipients are retried without resending to successful recipients.
import { withOrg } from './db.js';
import { PRODUCT } from './config.js';
import { notifyApproval } from './notify.js';

export function normalizeReminderSettings(hours, maximum) {
  const interval = Number.parseInt(hours, 10);
  const count = Number.parseInt(maximum, 10);
  return {
    reminderHours: Number.isFinite(interval) ? Math.min(720, Math.max(1, interval)) : 24,
    maxReminders: Number.isFinite(count) ? Math.min(20, Math.max(0, count)) : 3
  };
}
export function reminderDue({ status='pending', createdAt, lastRemindedAt=null, reminderCount=0, maxReminders=3, reminderHours=24 }, nowMs=Date.now()) {
  if (status !== 'pending' || Number(reminderCount) >= Number(maxReminders) || Number(maxReminders) <= 0) return false;
  const base = lastRemindedAt ? new Date(lastRemindedAt).getTime() : new Date(createdAt).getTime();
  return Number.isFinite(base) && nowMs >= base + Number(reminderHours) * 3600000;
}

async function claimRecipient(pool, orgId, approval, stageIndex, userId, reminderNumber) {
  return withOrg(pool, orgId, c => c.query(
    "insert into approval_reminder_log(org_id,approval_id,stage_index,user_id,reminder_number,status,attempts) values($1,$2,$3,$4,$5,'sending',1) on conflict(org_id,approval_id,stage_index,user_id,reminder_number) do update set status='sending',attempts=approval_reminder_log.attempts+1,last_error=null,updated_at=now() where approval_reminder_log.status='failed' or (approval_reminder_log.status='sending' and approval_reminder_log.updated_at < now()-interval '15 minutes') returning id",
    [orgId, approval.id, stageIndex, userId, reminderNumber]
  ));
}
async function markRecipient(pool, orgId, id, status, error='') {
  await withOrg(pool, orgId, c => c.query(
    'update approval_reminder_log set status=$3,last_error=$4,sent_at=case when $3=\'sent\' then now() else sent_at end,updated_at=now() where org_id=$1 and id=$2',
    [orgId, id, status, String(error || '').slice(0, 500) || null]
  ));
}
export async function runApprovalReminders(pool, mailer, nowMs=Date.now()) {
  if (!mailer || !mailer.agentNotice) return { approvals: 0, sent: 0, failed: 0 };
  let approvals=0, sent=0, failed=0;
  const orgs=(await pool.query('select id from "organization"')).rows;
  for (const {id:orgId} of orgs) {
    let due=[];
    try {
      due=await withOrg(pool,orgId,async c=>{
        const rows=(await c.query(
          "select a.id,a.ticket_number,a.title,a.stages,a.approver_ids,a.current_stage,a.reminder_count,a.max_reminders,t.subject,o.name org_name from approval_requests a join tickets t on t.id=a.ticket_id and t.org_id=a.org_id join \"organization\" o on o.id=a.org_id where a.org_id=$1 and a.status='pending' and a.max_reminders>a.reminder_count and coalesce(a.last_reminded_at,a.created_at) <= to_timestamp($2/1000.0)-make_interval(hours=>a.reminder_interval_hours) and (a.reminder_claimed_at is null or a.reminder_claimed_at < now()-interval '30 minutes') order by coalesce(a.last_reminded_at,a.created_at) limit 100 for update of a skip locked",
          [orgId,nowMs]
        )).rows;
        for(const a of rows) await c.query('update approval_requests set reminder_claimed_at=now() where org_id=$1 and id=$2',[orgId,a.id]);
        return rows;
      });
    } catch(e) { console.warn('approval reminder claim failed:',orgId,e.message); continue; }
    for(const a of due) {
      approvals++;
      const stageIndex=Math.max(0,Number(a.current_stage)||0);
      const stages=Array.isArray(a.stages)?a.stages:[];
      const stage=stages[stageIndex];
      const ids=[...new Set(((stage&&stage.approverIds)||a.approver_ids||[]).map(String))];
      const reminderNumber=Number(a.reminder_count)+1;
      let hadFailure=false;
      for(const userId of ids) {
        try {
          const person=(await pool.query('select u.email,coalesce(p.notify,true) notify from "user" u join member m on m."userId"=u.id and m."organizationId"=$1 left join desk_prefs p on p.user_id=u.id where u.id=$2',[orgId,userId])).rows[0];
          if(!person||!person.email||!person.notify) {
            const claim=await claimRecipient(pool,orgId,a,stageIndex,userId,reminderNumber);
            if(claim.rowCount) await markRecipient(pool,orgId,claim.rows[0].id,'skipped');
            continue;
          }
          const claim=await claimRecipient(pool,orgId,a,stageIndex,userId,reminderNumber);
          if(!claim.rowCount) continue;
          const logId=claim.rows[0].id;
          try {
            await mailer.agentNotice(person.email,{
              kind:'approval_reminder',orgName:a.org_name||'',number:a.ticket_number,
              subject:a.subject||a.title,summary:'Reminder '+reminderNumber+' of '+a.max_reminders+': your approval is still needed'+(stage?' for '+stage.name:'')+'.',
              url:PRODUCT.appUrl+'/desk.html?org='+encodeURIComponent(orgId)+'&ticket='+Number(a.ticket_number)
            });
            await markRecipient(pool,orgId,logId,'sent'); sent++;
          } catch(e) {
            await markRecipient(pool,orgId,logId,'failed',e.message); hadFailure=true; failed++;
          }
        } catch(e) { hadFailure=true; failed++; console.warn('approval reminder recipient failed:',e.message); }
      }
      await withOrg(pool,orgId,c=>c.query(
        hadFailure
          ? 'update approval_requests set reminder_claimed_at=null where org_id=$1 and id=$2'
          : 'update approval_requests set reminder_count=$3,last_reminded_at=to_timestamp($4/1000.0),reminder_claimed_at=null where org_id=$1 and id=$2',
        hadFailure?[orgId,a.id]:[orgId,a.id,reminderNumber,nowMs]
      ));
    }
  }
  return { approvals, sent, failed };
}

export async function runApprovalNotificationRetries(pool,mailer) {
  if(!mailer||!mailer.agentNotice)return { groups:0, sent:0 };
  const orgs=(await pool.query('select id from "organization"')).rows;
  let groups=0,sent=0;
  for(const {id:orgId} of orgs) {
    const pending=await withOrg(pool,orgId,c=>c.query(
      "select distinct n.approval_id,n.stage_index,n.event,a.created_by from approval_notifications n join approval_requests a on a.org_id=n.org_id and a.id=n.approval_id where n.org_id=$1 and (n.delivery_status='failed' or (n.delivery_status='sending' and n.updated_at < now()-interval '15 minutes')) order by n.approval_id,n.stage_index,n.event limit 100",
      [orgId]
    ));
    for(const item of pending.rows) {
      groups++;
      const r=await notifyApproval(pool,mailer,orgId,Number(item.approval_id),Number(item.stage_index)||0,item.event,item.created_by);
      sent+=Number(r.sent)||0;
    }
  }
  return { groups,sent };
}
