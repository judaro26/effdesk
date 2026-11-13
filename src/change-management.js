// Change Management: tenant-scoped change records with risk, scheduling, sequential approvals and linked services/incidents.
import { withOrg } from './db.js';
import { normalizeApprovalConfig, validateApprovalConfig, approvalStageOutcome } from './approvals.js';
import { notifyChangeApproval } from './notify.js';

const clean=(v,n)=>String(v==null?'':v).replace(/\u0000/g,'').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
export const CHANGE_TYPES=['standard','normal','emergency'];
export const CHANGE_STATUSES=['draft','submitted','assessing','awaiting_approval','approved','rejected','scheduled','implementing','completed','failed','cancelled'];
export const CHANGE_RISKS=['low','medium','high','critical'];
export const CHANGE_TRANSITIONS={
 draft:['draft','submitted','assessing','awaiting_approval','cancelled'],
 submitted:['submitted','assessing','awaiting_approval','approved','cancelled'],
 assessing:['assessing','awaiting_approval','approved','cancelled'],
 awaiting_approval:['awaiting_approval','approved','rejected','cancelled'],
 approved:['approved','scheduled','cancelled'],
 rejected:['rejected','draft','cancelled'],
 scheduled:['scheduled','implementing','cancelled'],
 implementing:['implementing','completed','failed'],
 completed:['completed'],failed:['failed'],cancelled:['cancelled']
};
const validDate=v=>v&&Number.isFinite(new Date(v).getTime())?new Date(v):null;
export function normalizeChange(input={}){
 const type=CHANGE_TYPES.includes(input.changeType)?input.changeType:'normal';
 const status=CHANGE_STATUSES.includes(input.status)?input.status:'draft';
 const risk=CHANGE_RISKS.includes(input.risk)?input.risk:'medium';
 const impact=CHANGE_RISKS.includes(input.impact)?input.impact:'medium';
 return {
  title:clean(input.title,180),description:clean(input.description,5000),changeType:type,status,risk,impact,
  plannedStart:validDate(input.plannedStart),plannedEnd:validDate(input.plannedEnd),
  implementationPlan:clean(input.implementationPlan,8000),testPlan:clean(input.testPlan,5000),
  rollbackPlan:clean(input.rollbackPlan,5000),outcome:clean(input.outcome,5000),
  ownerId:clean(input.ownerId,128)
 };
}
const linkIds=(a,max)=>[...new Set((Array.isArray(a)?a:[]).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,max);
async function log(c,orgId,id,actor,event,detail){
 await c.query('insert into change_events(org_id,change_id,actor_id,actor_name,event,detail) values($1,$2,$3,$4,$5,$6)',
 [orgId,id,actor.id||null,clean(actor.name||actor.email||actor.id,180),event,clean(detail,2000)]);
}
export async function listChanges(pool,orgId,{status='',risk='',q='',from='',to='',limit=100}={}){
 const args=[orgId],where=['c.org_id=$1'];
 if(CHANGE_STATUSES.includes(status)){args.push(status);where.push('c.status=$'+args.length);}
 if(CHANGE_RISKS.includes(risk)){args.push(risk);where.push('c.risk=$'+args.length);}
 const term=clean(q,160);if(term){args.push('%'+term+'%');where.push('(c.title ilike $'+args.length+' or c.description ilike $'+args.length+')');}
 if(validDate(from)){args.push(validDate(from));where.push('coalesce(c.planned_start,c.created_at)>=$'+args.length);}
 if(validDate(to)){args.push(validDate(to));where.push('coalesce(c.planned_start,c.created_at)<=$'+args.length);}
 args.push(Math.min(Math.max(Number(limit)||100,1),200));
 return withOrg(pool,orgId,async c=>({ok:true,changes:(await c.query(`select c.id,c.title,c.change_type,c.status,c.risk,c.impact,c.planned_start,c.planned_end,c.owner_id,c.created_at,c.updated_at,u.name owner_name,u.email owner_email,
  (select count(*)::int from change_services x where x.org_id=c.org_id and x.change_id=c.id) service_count,
  (select count(*)::int from change_incidents x where x.org_id=c.org_id and x.change_id=c.id) incident_count,
  (select count(*)::int from change_decisions d where d.org_id=c.org_id and d.change_id=c.id) decision_count
  from change_requests c left join "user" u on u.id=c.owner_id where ${where.join(' and ')}
  order by case when c.status in ('scheduled','approved') then 0 else 1 end, c.planned_start nulls last,c.updated_at desc limit $${args.length}`,args)).rows}));
}
export async function getChange(pool,orgId,id){
 return withOrg(pool,orgId,async c=>{
  const change=(await c.query('select c.*,u.name owner_name,u.email owner_email from change_requests c left join "user" u on u.id=c.owner_id where c.org_id=$1 and c.id=$2',[orgId,Number(id)||0])).rows[0];
  if(!change)return fail('No such change request.',404);
  const [services,incidents,decisions,events]=await Promise.all([
   c.query('select s.id,s.name,s.criticality,s.status from change_services x join business_services s on s.org_id=x.org_id and s.id=x.service_id where x.org_id=$1 and x.change_id=$2 order by lower(s.name)',[orgId,change.id]),
   c.query(`select t.number,t.subject,t.status,t.priority from change_incidents x join tickets t on t.org_id=x.org_id and t.id=x.ticket_id where x.org_id=$1 and x.change_id=$2 order by t.number`,[orgId,change.id]),
   c.query('select id,round_index,stage_index,approver_id,decision,comment,created_at from change_decisions where org_id=$1 and change_id=$2 order by round_index,stage_index,created_at',[orgId,change.id]),
   c.query('select id,actor_id,actor_name,event,detail,created_at from change_events where org_id=$1 and change_id=$2 order by created_at desc,id desc limit 100',[orgId,change.id])
  ]);
  return {ok:true,change,services:services.rows,incidents:incidents.rows,decisions:decisions.rows,events:events.rows};
 });
}
export async function saveChange(pool,orgId,actor,input={},mailer=null){
 const d=normalizeChange(input),hasId=input.id!==undefined&&input.id!==null&&input.id!=='',id=hasId?Number(input.id):0;
 if(!d.title)return fail('Give the change request a title.');
 if(input.plannedStart&&!d.plannedStart||input.plannedEnd&&!d.plannedEnd)return fail('Enter a valid maintenance window date and time.');
 if(hasId&&(!Number.isSafeInteger(id)||id<1))return fail('Choose a valid change request.');
 if(d.plannedStart&&d.plannedEnd&&d.plannedEnd<=d.plannedStart)return fail('The maintenance window must end after it starts.');
 const serviceIds=linkIds(input.serviceIds,50),incidentNumbers=linkIds(input.incidentNumbers,100).filter(n=>n<=2147483647);
 const cfg=normalizeApprovalConfig({enabled:true,stages:Array.isArray(input.approvalStages)?input.approvalStages:[]});
 const result=await withOrg(pool,orgId,async c=>{
  if(d.ownerId){const m=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2',[orgId,d.ownerId])).rows[0];if(!m||m.role==='light')return fail('The change owner must be a full workspace member.');}
  if(serviceIds.length){const r=await c.query('select id from business_services where org_id=$1 and id=any($2::bigint[])',[orgId,serviceIds]);if(r.rowCount!==serviceIds.length)return fail('One or more selected services do not belong to this workspace.');}
  if(incidentNumbers.length){const r=await c.query("select id,number from tickets where org_id=$1 and type='incident' and number=any($2::int[])",[orgId,incidentNumbers]);if(r.rowCount!==incidentNumbers.length)return fail('Every linked ticket must be an incident in this workspace.');}
  let before=null,saved,event='updated';
  if(id){before=(await c.query('select status,approval_stages,approval_round from change_requests where org_id=$1 and id=$2 for update',[orgId,id])).rows[0];if(!before)return fail('No such change request.',404);
   if(!(CHANGE_TRANSITIONS[before.status]||[]).includes(d.status))return fail('That change-status transition is not allowed. Move the request through the change lifecycle.',409);
   if(before.status==='awaiting_approval'&&JSON.stringify((before.approval_stages||[]).map(s=>({name:s.name,mode:s.mode,approverIds:s.approverIds||[]})))!==JSON.stringify(cfg.stages.map(s=>({name:s.name,mode:s.mode,approverIds:s.approverIds||[]}))))return fail('Approval stages cannot be changed while a decision is in progress.',409);
   if(d.status==='approved'&&before.status!=='awaiting_approval'&&d.changeType!=='standard')return fail('Normal and emergency changes must pass their configured approval stages before approval.',409);
   if(d.status==='approved'&&before.status!=='awaiting_approval'&&d.changeType==='standard'&&(d.risk!=='low'||['high','critical'].includes(d.impact)))return fail('The pre-authorized path is limited to low-risk standard changes with low or medium impact.',409);
  }else if(d.status!=='draft'&&d.status!=='submitted'&&d.status!=='assessing'&&d.status!=='awaiting_approval')return fail('A new change request must start as a draft or enter assessment.');
  if(d.status==='awaiting_approval'){
   if(!cfg.stages.length||cfg.stages.some(s=>!s.approverIds.length))return fail('Add at least one full-agent approver before requesting approval.');
   const v=await validateApprovalConfig(c,orgId,{enabled:true,stages:cfg.stages});if(!v.ok)return v;
  }
  if(d.status==='approved'&&before&&before.status==='awaiting_approval')return fail('Only the assigned approvers can approve this change.');
  if(d.status==='rejected'&&before&&before.status==='awaiting_approval')return fail('Only the assigned approvers can reject this change.');
  if(d.status==='scheduled'&&(!d.plannedStart||!d.plannedEnd))return fail('Set both planned start and end before scheduling the change.');
  if(d.status==='implementing'&&(!d.implementationPlan||!d.rollbackPlan))return fail('Document the implementation and rollback plans before starting work.');
  if((d.status==='completed'||d.status==='failed')&&!d.outcome)return fail('Record the implementation outcome before closing the change.');
  const values=[d.title,d.description,d.changeType,d.status,d.risk,d.impact,d.plannedStart,d.plannedEnd,d.implementationPlan,d.testPlan,d.rollbackPlan,d.outcome,d.ownerId||null,JSON.stringify(cfg.stages)];
  if(id){
   saved=(await c.query(`update change_requests set title=$3,description=$4,change_type=$5,status=$6,risk=$7,impact=$8,planned_start=$9,planned_end=$10,implementation_plan=$11,test_plan=$12,rollback_plan=$13,outcome=$14,owner_id=$15,approval_stages=$16::jsonb,approval_round=case when $6='draft' and status='rejected' then approval_round+1 else approval_round end,approved_at=case when $6='approved' then coalesce(approved_at,now()) else approved_at end,completed_at=case when $6='completed' then coalesce(completed_at,now()) else completed_at end,updated_at=now() where org_id=$1 and id=$2 returning id,status,current_stage`,[orgId,id,...values])).rows[0];
   event=before.status!==d.status?'status_changed':'updated';
  }else{
   saved=(await c.query(`insert into change_requests(org_id,title,description,change_type,status,risk,impact,planned_start,planned_end,implementation_plan,test_plan,rollback_plan,outcome,owner_id,requested_by,approval_stages)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb) returning id,status,current_stage`,[orgId,...values.slice(0,13),actor.id||null,values[13]])).rows[0];
   event='created';
  }
  const oldServices=(await c.query('select service_id from change_services where org_id=$1 and change_id=$2',[orgId,saved.id])).rows.map(x=>Number(x.service_id));
  const oldIncidents=(await c.query('select ticket_id from change_incidents where org_id=$1 and change_id=$2',[orgId,saved.id])).rows.map(x=>Number(x.ticket_id));
  const newServices=serviceIds.length?(await c.query('select id from business_services where org_id=$1 and id=any($2::bigint[])',[orgId,serviceIds])).rows.map(x=>Number(x.id)):[];
  const newIncidents=incidentNumbers.length?(await c.query("select id from tickets where org_id=$1 and type='incident' and number=any($2::int[])",[orgId,incidentNumbers])).rows.map(x=>Number(x.id)):[];
  await c.query('delete from change_services where org_id=$1 and change_id=$2',[orgId,saved.id]);
  await c.query('delete from change_incidents where org_id=$1 and change_id=$2',[orgId,saved.id]);
  for(const sid of newServices)await c.query('insert into change_services(org_id,change_id,service_id) values($1,$2,$3)',[orgId,saved.id,sid]);
  for(const tid of newIncidents)await c.query('insert into change_incidents(org_id,change_id,ticket_id) values($1,$2,$3)',[orgId,saved.id,tid]);
  await log(c,orgId,saved.id,actor,event,(event==='created'?'Change request created: ':event==='status_changed'?'Status changed to ':'Change request updated: ')+d.title);
  if(newServices.filter(x=>!oldServices.includes(x)).length)await log(c,orgId,saved.id,actor,'service_linked','Affected services updated');
  if(newIncidents.filter(x=>!oldIncidents.includes(x)).length)await log(c,orgId,saved.id,actor,'incident_linked','Related incidents updated');
  if(d.status==='awaiting_approval'&&(!before||before.status!=='awaiting_approval'))await c.query('update change_requests set current_stage=0 where org_id=$1 and id=$2',[orgId,saved.id]);
  return {ok:true,id:saved.id,status:saved.status,notify:d.status==='awaiting_approval'&&(!before||before.status!=='awaiting_approval')};
 });
 if(result.ok&&result.notify)await notifyChangeApproval(pool,mailer,orgId,result.id,0,'requested');
 return result.ok?getChange(pool,orgId,result.id):result;
}
export async function decideChange(pool,orgId,actor,id,decision,comment='',mailer=null){
 const actorId=String(actor&&actor.id||actor||'');
 if(!['approved','rejected'].includes(decision))return fail('Choose approve or reject.');
 const result=await withOrg(pool,orgId,async c=>{
  const row=(await c.query('select * from change_requests where org_id=$1 and id=$2 for update',[orgId,Number(id)||0])).rows[0];
  if(!row)return fail('No such change request.',404);if(row.status!=='awaiting_approval')return fail('This change is not awaiting approval.',409);
  const stages=Array.isArray(row.approval_stages)?row.approval_stages:[];
  const ix=Math.max(0,Math.min(Number(row.current_stage)||0,stages.length-1)),stage=stages[ix];
  if(!stage||!(stage.approverIds||[]).includes(String(actorId)))return fail('You are not an approver for the active stage.',403);
  const round=Number(row.approval_round)||1;
  const prior=await c.query('select 1 from change_decisions where org_id=$1 and change_id=$2 and round_index=$3 and stage_index=$4 and approver_id=$5',[orgId,row.id,round,ix,String(actorId)]);
  if(prior.rowCount)return fail('You have already responded to this approval stage.',409);
  await c.query('insert into change_decisions(org_id,change_id,round_index,stage_index,approver_id,decision,comment) values($1,$2,$3,$4,$5,$6,$7)',[orgId,row.id,round,ix,String(actorId),decision,clean(comment,2000)]);
  const counts=(await c.query("select count(*) filter(where decision='approved')::int approved,count(*) filter(where decision='rejected')::int rejected from change_decisions where org_id=$1 and change_id=$2 and round_index=$3 and stage_index=$4",[orgId,row.id,round,ix])).rows[0];
  const outcome=decision==='rejected'?'rejected':approvalStageOutcome(stage,counts.approved,counts.rejected);
  let status='awaiting_approval',nextStage=null,event='decided';
  if(outcome==='rejected'){status='rejected';event='rejected';await c.query("update change_requests set status='rejected',updated_at=now() where org_id=$1 and id=$2",[orgId,row.id]);}
  else if(outcome==='complete'&&ix+1<stages.length){nextStage=ix+1;await c.query('update change_requests set current_stage=$3,updated_at=now() where org_id=$1 and id=$2',[orgId,row.id,nextStage]);}
  else if(outcome==='complete'){status='approved';event='completed';await c.query("update change_requests set status='approved',approved_at=now(),updated_at=now() where org_id=$1 and id=$2",[orgId,row.id]);}
  await log(c,orgId,row.id,{id:actorId,name:actor&&actor.name||actor&&actor.email||actorId},'approval_decided','Approval round '+round+' · '+decision+' · '+(stage.name||('Stage '+(ix+1))));
  return {ok:true,status,nextStage,event,createdBy:row.requested_by,stageIndex:ix};
 });
 if(result.ok&&mailer){
  if(result.nextStage!==null)await notifyChangeApproval(pool,mailer,orgId,id,result.nextStage,'requested');
  else await notifyChangeApproval(pool,mailer,orgId,id,result.stageIndex,result.event,result.createdBy,actorId);
 }
 return result.ok?getChange(pool,orgId,id):result;
}
