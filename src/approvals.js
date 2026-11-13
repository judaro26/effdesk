// Tenant-scoped approval workflow, sequential stages and fulfillment tasks.
import { withOrg } from './db.js';
import { notifyApproval } from './notify.js';
const clean=(v,n)=>String(v==null?'':v).replace(/\u0000/g,'').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
const states=['open','in_progress','done','cancelled'];
export function normalizeApprovalConfig(b){
 b=b&&typeof b==='object'?b:{};
 const cleanStage=(s,i)=>({name:clean(s&&s.name,80)||'Stage '+(i+1),mode:s&&s.mode==='any'?'any':'all',approverIds:[...new Set((Array.isArray(s&&s.approverIds)?s.approverIds:[]).map(x=>clean(x,128)).filter(Boolean))].slice(0,30)});
 let stages=Array.isArray(b.stages)?b.stages.slice(0,10).map(cleanStage):[];
 if(!stages.length&&Array.isArray(b.approverIds)&&b.approverIds.length)stages=[cleanStage({name:'Approval',mode:b.mode,approverIds:b.approverIds},0)];
 const first=stages[0]||{name:'Approval',mode:b.mode==='any'?'any':'all',approverIds:[]};
 return {enabled:b.enabled===true,mode:stages.length>1||b.mode==='sequential'?'sequential':first.mode,approverIds:first.approverIds,stages,tasks:(Array.isArray(b.tasks)?b.tasks:[]).slice(0,20).map((t,i)=>({title:clean(t&&t.title,160),description:clean(t&&t.description,3000),assigneeId:clean(t&&t.assigneeId,128),position:i})).filter(t=>t.title)};
}
export function approvalStageOutcome(stage,approvedCount,rejectedCount=0){\n if(rejectedCount>0)return 'rejected';\n if(stage&&stage.mode==='any'&&approvedCount>0)return 'complete';\n return approvedCount>=((stage&&stage.approverIds)||[]).length?'complete':'pending';\n}\nexport async function validateApprovalConfig(c,orgId,input){
 const config=normalizeApprovalConfig(input); if(!config.enabled)return {ok:true,config};
 if(!config.stages.length||config.stages.some(s=>!s.approverIds.length))return fail('Choose at least one approver for every approval stage.');
 const ids=[...new Set([...config.stages.flatMap(s=>s.approverIds),...config.tasks.map(t=>t.assigneeId).filter(Boolean)])];
 const rows=(await c.query('select "userId",role from member where "organizationId"=$1 and "userId"=any($2)',[orgId,ids])).rows;
 if(rows.length!==ids.length)return fail('Approvers and task assignees must be members of this workspace.');
 if(rows.some(x=>x.role==='light'))return fail('Light agents cannot be approvers or fulfillment task assignees. Choose a full agent or workspace admin.');
 return {ok:true,config};
}
export async function createForTicket(pool,orgId,ticket,formId,actorId=null,mailer=null){
 if(!formId)return {ok:true,skipped:true};
 const result=await withOrg(pool,orgId,async c=>{
  const f=(await c.query('select id,name,approval_config from request_forms where org_id=$1 and id=$2 and active',[orgId,formId])).rows[0];
  if(!f)return {ok:true,skipped:true}; const v=await validateApprovalConfig(c,orgId,f.approval_config); if(!v.ok)return v; if(!v.config.enabled)return {ok:true,skipped:true};
  const stages=v.config.stages,first=stages[0];
  const a=(await c.query("insert into approval_requests(org_id,ticket_id,ticket_number,form_id,mode,approver_ids,stages,current_stage,created_by,title) values($1,$2,$3,$4,$5,$6,$7::jsonb,0,$8,$9) on conflict(org_id,ticket_id) do nothing returning id",[orgId,ticket.id,ticket.number,f.id,first.mode,first.approverIds,JSON.stringify(stages),actorId,'Approval: '+f.name])).rows[0];
  if(!a)return {ok:true,skipped:true};
  for(const t of v.config.tasks)await c.query('insert into fulfillment_tasks(org_id,ticket_id,approval_id,title,description,assignee_id,position,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[orgId,ticket.id,a.id,t.title,t.description,t.assigneeId||null,t.position,actorId]);
  return {ok:true,approvalId:a.id,stageIndex:0};
 });
 if(result.ok&&result.approvalId&&mailer)await notifyApproval(pool,mailer,orgId,result.approvalId,0,'requested');
 return result;
}
export async function getApprovalForTicket(pool,orgId,ticketNumber){
 return withOrg(pool,orgId,async c=>{
  const a=(await c.query("select a.id,a.ticket_id,a.ticket_number,a.status,a.mode,a.approver_ids,a.stages,a.current_stage,a.title,a.created_at,a.decided_at,coalesce((select json_agg(json_build_object('approverId',d.approver_id,'decision',d.decision,'comment',d.comment,'stageIndex',d.stage_index,'createdAt',d.created_at) order by d.stage_index,d.created_at) from approval_decisions d where d.org_id=a.org_id and d.approval_id=a.id),'[]'::json) decisions from approval_requests a join tickets t on t.id=a.ticket_id and t.org_id=a.org_id where a.org_id=$1 and t.number=$2",[orgId,Number(ticketNumber)])).rows[0];
  return {ok:true,approval:a||null};
 });
}
export async function listApprovals(pool,orgId,actorId,{mine=false,status='pending'}={}){
 return withOrg(pool,orgId,async c=>({ok:true,approvals:(await c.query("select a.id,a.ticket_id,a.ticket_number,a.status,a.mode,a.approver_ids,a.stages,a.current_stage,a.title,a.created_at,t.subject,t.requester_name,t.requester_email,coalesce((select json_agg(json_build_object('approverId',d.approver_id,'decision',d.decision,'comment',d.comment,'stageIndex',d.stage_index,'createdAt',d.created_at) order by d.stage_index,d.created_at) from approval_decisions d where d.org_id=a.org_id and d.approval_id=a.id),'[]'::json) decisions from approval_requests a join tickets t on t.id=a.ticket_id and t.org_id=a.org_id where a.org_id=$1 and ($2::text is null or a.status=$2) and (not $3::boolean or $4=any(a.approver_ids)) order by a.created_at desc limit 200",[orgId,status||null,!!mine,actorId])).rows}));
}
export async function decideApproval(pool,orgId,actorId,id,decision,comment='',mailer=null){
 if(!['approved','rejected'].includes(decision))return fail('Choose approve or reject.');
 const result=await withOrg(pool,orgId,async c=>{
  const a=(await c.query('select * from approval_requests where org_id=$1 and id=$2 for update',[orgId,Number(id)])).rows[0];
  if(!a)return fail('No such approval.',404); if(a.status!=='pending')return fail('This approval has already been decided.',409);
  const stages=Array.isArray(a.stages)&&a.stages.length?a.stages:[{name:'Approval',mode:a.mode,approverIds:a.approver_ids}];
  const stageIndex=Math.max(0,Math.min(Number(a.current_stage)||0,stages.length-1)),stage=stages[stageIndex];
  if(!(stage.approverIds||[]).includes(String(actorId)))return fail('You are not an approver for the active stage.',403);
  const prior=await c.query('select 1 from approval_decisions where org_id=$1 and approval_id=$2 and stage_index=$3 and approver_id=$4',[orgId,a.id,stageIndex,String(actorId)]);
  if(prior.rowCount)return fail('You have already responded to this stage.',409);
  await c.query('insert into approval_decisions(org_id,approval_id,approver_id,stage_index,decision,comment) values($1,$2,$3,$4,$5,$6)',[orgId,a.id,String(actorId),stageIndex,decision,clean(comment,2000)]);
  const count=(await c.query("select count(*) filter(where decision='approved')::int approved,count(*) filter(where decision='rejected')::int rejected from approval_decisions where org_id=$1 and approval_id=$2 and stage_index=$3",[orgId,a.id,stageIndex])).rows[0];
  const outcome=decision==='rejected'?'rejected':approvalStageOutcome(stage,count.approved,count.rejected);\n  const stageDone=outcome!=='pending';
  let status='pending',nextStage=null,event='decided';
  if(decision==='rejected'){
   status='rejected';event='rejected';
   await c.query("update fulfillment_tasks set status='cancelled',updated_at=now() where org_id=$1 and approval_id=$2 and status<>'done'",[orgId,a.id]);
   await c.query('update approval_requests set status=$3,decided_at=now() where org_id=$1 and id=$2',[orgId,a.id,status]);
  }else if(stageDone&&stageIndex+1<stages.length){
   nextStage=stageIndex+1;const next=stages[nextStage];
   await c.query('update approval_requests set current_stage=$3,mode=$4,approver_ids=$5 where org_id=$1 and id=$2',[orgId,a.id,nextStage,next.mode,next.approverIds]);
  }else if(stageDone){
   status='approved';event='completed';
   await c.query('update approval_requests set status=$3,decided_at=now() where org_id=$1 and id=$2',[orgId,a.id,status]);
  }
  await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,$4,$5)',[orgId,a.ticket_id,String(actorId),'approval','Approval '+decision+' · '+stage.name+(stageDone?' · '+(status==='pending'?'next stage started':status):'')]);
  return {ok:true,status,approved:count.approved,rejected:count.rejected,required:stage.mode==='any'?1:stage.approverIds.length,stageIndex,nextStage,createdBy:a.created_by,event};
 });
 if(result.ok&&mailer){
  await notifyApproval(pool,mailer,orgId,Number(id),result.stageIndex,result.event,result.createdBy);
  if(result.nextStage!==null)await notifyApproval(pool,mailer,orgId,Number(id),result.nextStage,'requested');
 }
 return result;
}
export async function listTasks(pool,orgId,ticketNumber){
 return withOrg(pool,orgId,async c=>({ok:true,tasks:(await c.query('select f.id,f.ticket_id,t.number ticket_number,f.title,f.description,f.assignee_id,f.status,f.position,f.created_at,f.updated_at from fulfillment_tasks f join tickets t on t.id=f.ticket_id and t.org_id=f.org_id where f.org_id=$1 and ($2::bigint is null or t.number=$2) order by f.position,f.id',[orgId,ticketNumber?Number(ticketNumber):null])).rows}));
}
export async function updateTask(pool,orgId,id,patch){
 return withOrg(pool,orgId,async c=>{
  const t=(await c.query('select id,status from fulfillment_tasks where org_id=$1 and id=$2 for update',[orgId,Number(id)])).rows[0];if(!t)return fail('No such task.',404);
  const status=patch.status===undefined?t.status:patch.status;if(!states.includes(status))return fail('That task status does not exist.');
  const assignee=patch.assigneeId===undefined?null:clean(patch.assigneeId,128)||null;
  if(assignee&&!((await c.query('select 1 from member where "organizationId"=$1 and "userId"=$2',[orgId,assignee])).rowCount))return fail('That assignee is not a member of this workspace.');
  const r=await c.query('update fulfillment_tasks set status=$3,assignee_id=case when $4::boolean then $5 else assignee_id end,updated_at=now() where org_id=$1 and id=$2 returning id,status,assignee_id,updated_at',[orgId,t.id,status,patch.assigneeId!==undefined,assignee]);
  return {ok:true,task:r.rows[0]};
 });
}
