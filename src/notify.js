// Agent email notifications for tickets and approval workflows.
import { withOrg } from './db.js';
import { PRODUCT } from './config.js';
export async function notifyApproval(pool,mailer,orgId,approvalId,stageIndex=0,event='requested',createdBy=null,actorId=null){
 if(!mailer||!mailer.agentNotice)return {sent:0};
 try{
  const data=await withOrg(pool,orgId,async c=>{
   const a=(await c.query('select a.id,a.ticket_number,a.title,a.stages,a.approver_ids,a.created_by,t.subject from approval_requests a join tickets t on t.id=a.ticket_id and t.org_id=a.org_id where a.org_id=$1 and a.id=$2',[orgId,Number(approvalId)])).rows[0];
   if(!a)return null;
   const org=(await c.query('select name from "organization" where id=$1',[orgId])).rows[0];
   const ids=event==='requested'?((Array.isArray(a.stages)&&a.stages[stageIndex]&&a.stages[stageIndex].approverIds)||a.approver_ids||[]):[createdBy||a.created_by].filter(Boolean);
   return {a,orgName:org?.name||'',ids:[...new Set(ids.map(String))].filter(id=>id!==String(actorId||''))};
  });
  if(!data||!data.ids.length)return {sent:0};
  let sent=0;
  for(const id of data.ids){
   const p=(await pool.query('select u.email,coalesce(p.notify,true) notify from "user" u join member m on m."userId"=u.id and m."organizationId"=$1 left join desk_prefs p on p.user_id=u.id where u.id=$2',[orgId,id])).rows[0];
   if(!p||!p.email||!p.notify)continue;
   const claim=await withOrg(pool,orgId,c=>c.query("insert into approval_notifications(org_id,approval_id,stage_index,user_id,event,delivery_status,attempts) values($1,$2,$3,$4,$5,'sending',1) on conflict(org_id,approval_id,stage_index,user_id,event) do update set delivery_status='sending',attempts=approval_notifications.attempts+1,last_error=null,updated_at=now() where approval_notifications.delivery_status='failed' or (approval_notifications.delivery_status='sending' and approval_notifications.updated_at < now()-interval '15 minutes') returning id",[orgId,Number(approvalId),Number(stageIndex)||0,id,event]));
   if(!claim.rowCount)continue;
   const logId=claim.rows[0].id;
   const what=event==='requested'?'approval_requested':event==='rejected'?'approval_rejected':event==='completed'?'approval_completed':'approval_decided';
   const stage=(Array.isArray(data.a.stages)&&data.a.stages[stageIndex])||null;
   const summary=event==='requested'?'Your approval is needed'+(stage?' for '+stage.name:'')+'.':'Approval update: '+(event==='rejected'?'request rejected':event==='completed'?'all stages approved':'a decision was recorded')+'.';
   try{
    await mailer.agentNotice(p.email,{kind:what,orgName:data.orgName,number:data.a.ticket_number,subject:data.a.subject||data.a.title,summary,url:PRODUCT.appUrl+'/desk.html?org='+encodeURIComponent(orgId)+'&ticket='+Number(data.a.ticket_number)});
    await withOrg(pool,orgId,c=>c.query("update approval_notifications set delivery_status='sent',last_error=null,updated_at=now() where org_id=$1 and id=$2",[orgId,logId]));sent++;
   }catch(e){
    await withOrg(pool,orgId,c=>c.query("update approval_notifications set delivery_status='failed',last_error=$3,updated_at=now() where org_id=$1 and id=$2",[orgId,logId,String(e.message||e).slice(0,500)]));
    console.warn('approval notice failed:',e.message);
   }
  }
  return {sent};
 }catch(e){console.warn('approval notification error:',e.message);return {sent:0};}
}
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
    const people = (await pool.query('select u.id, u.email, coalesce(p.notify, true) notify from "user" u join member m on m."userId" = u.id and m."organizationId" = $1 left join desk_prefs p on p.user_id = u.id where u.id = any($2)', [orgId, data.ids])).rows.filter(p => p.notify);
    let sent = 0;
    for (const p of people) {
      if (kind !== 'assigned') {
        const hit = (await pool.query("insert into desk_notify_log (user_id, ticket_id) values ($1,$2) on conflict (user_id, ticket_id) do update set notified_at = now() where desk_notify_log.notified_at < now() - interval '10 minutes' returning 1", [p.id, data.t.id])).rowCount;
        if (!hit) continue;
      }
      try { await mailer.agentNotice(p.email, { kind, orgName: data.orgName, number, subject: data.t.subject, summary: String(summary || '').slice(0, 300), url: PRODUCT.appUrl+'/desk.html?org='+encodeURIComponent(orgId)+'&ticket='+Number(number) }); sent++; } catch (e) { console.warn('agent notice failed:', e.message); }
    }
    return { sent };
  } catch (e) { console.warn('notify error:', e.message); return { sent: 0 }; }
}
