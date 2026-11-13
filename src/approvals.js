// Tenant-scoped approval workflow and fulfillment task services.
import { withOrg } from './db.js';
const clean=(v,n)=>String(v==null?'':v).replace(/\u0000/g,'').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
const states=['open','in_progress','done','cancelled'];
export function normalizeApprovalConfig(b){
 b=b&&typeof b==='object'?b:{};
 return {enabled:b.enabled===true,mode:b.mode==='any'?'any':'all',
 approverIds:[...new Set((Array.isArray(b.approverIds)?b.approverIds:[]).map(x=>clean(x,128)).filter(Boolean))].slice(0,30),
 tasks:(Array.isArray(b.tasks)?b.tasks:[]).slice(0,20).map((t,i)=>({title:clean(t&&t.title,160),description:clean(t&&t.description,3000),assigneeId:clean(t&&t.assigneeId,128),position:i})).filter(t=>t.title)};
}
export async function validateApprovalConfig(c,orgId,input){
 const config=normalizeApprovalConfig(input); if(!config.enabled)return {ok:true,config};
 if(!config.approverIds.length)return fail('Choose at least one approver.');
 const ids=[...new Set([...config.approverIds,...config.tasks.map(t=>t.assigneeId).filter(Boolean)])];
 const rows=(await c.query('select "userId" from member where "organizationId"=$1 and "userId"=any($2)',[orgId,ids])).rows;
 if(rows.length!==ids.length)return fail('Approvers and task assignees must be members of this workspace.');
 return {ok:true,config};
}
export async function createForTicket(pool,orgId,ticket,formId,actorId=null){
 if(!formId)return {ok:true,skipped:true};
 return withOrg(pool,orgId,async c=>{
  const f=(await c.query('select id,name,approval_config from request_forms where org_id=$1 and id=$2 and active',[orgId,formId])).rows[0];
  const v=await validateApprovalConfig(c,orgId,f&&f.approval_config); if(!f||!v.config.enabled)return {ok:true,skipped:true}; if(!v.ok)return v;
  const a=(await c.query("insert into approval_requests(org_id,ticket_id,ticket_number,form_id,mode,approver_ids,title) values($1,$2,$3,$4,$5,$6,$7) on conflict(org_id,ticket_id) do nothing returning id",[orgId,ticket.id,ticket.number,f.id,v.config.mode,v.config.approverIds,'Approval: '+f.name])).rows[0];
  if(!a)return {ok:true,skipped:true};
  for(const t of v.config.tasks)await c.query('insert into fulfillment_tasks(org_id,ticket_id,approval_id,title,description,assignee_id,position,created_by) values($1,$2,$3,$4,$5,$6,$7,$8)',[orgId,ticket.id,a.id,t.title,t.description,t.assigneeId||null,t.position,actorId]);
  return {ok:true,approvalId:a.id};
 });
}
export async function listApprovals(pool,orgId,actorId,{mine=false,status='pending'}={}){
 return withOrg(pool,orgId,async c=>({ok:true,approvals:(await c.query("select a.id,a.ticket_id,a.ticket_number,a.status,a.mode,a.approver_ids,a.title,a.created_at,t.subject,t.requester_name,t.requester_email,coalesce((select json_agg(json_build_object('approverId',d.approver_id,'decision',d.decision,'comment',d.comment,'createdAt',d.created_at) order by d.created_at) from approval_decisions d where d.org_id=a.org_id and d.approval_id=a.id),'[]'::json) decisions from approval_requests a join tickets t on t.id=a.ticket_id and t.org_id=a.org_id where a.org_id=$1 and ($2::text is null or a.status=$2) and (not $3::boolean or $4=any(a.approver_ids)) order by a.created_at desc limit 200",[orgId,status||null,!!mine,actorId])).rows}));
}
export async function decideApproval(pool,orgId,actorId,id,decision,comment=''){
 if(!['approved','rejected'].includes(decision))return fail('Choose approve or reject.');
 return withOrg(pool,orgId,async c=>{
  const a=(await c.query('select * from approval_requests where org_id=$1 and id=$2 for update',[orgId,Number(id)])).rows[0];
  if(!a)return fail('No such approval.',404); if(a.status!=='pending')return fail('This approval has already been decided.',409);
  if(!a.approver_ids.includes(String(actorId)))return fail('You are not an approver for this request.',403);
  const prior=await c.query('select 1 from approval_decisions where org_id=$1 and approval_id=$2 and approver_id=$3',[orgId,a.id,String(actorId)]);
  if(prior.rowCount)return fail('You have already responded to this request.',409);
  await c.query('insert into approval_decisions(org_id,approval_id,approver_id,decision,comment) values($1,$2,$3,$4,$5)',[orgId,a.id,String(actorId),decision,clean(comment,2000)]);
  const count=(await c.query("select count(*) filter(where decision='approved')::int approved,count(*) filter(where decision='rejected')::int rejected from approval_decisions where org_id=$1 and approval_id=$2",[orgId,a.id])).rows[0];
  const terminal=decision==='rejected'||(a.mode==='any'&&count.approved>0)||(a.mode==='all'&&count.approved>=a.approver_ids.length);
  const status=decision==='rejected'?'rejected':terminal?'approved':'pending';
  if(terminal){await c.query('update approval_requests set status=$3,decided_at=now() where org_id=$1 and id=$2',[orgId,a.id,status]);if(status==='rejected')await c.query("update fulfillment_tasks set status='cancelled',updated_at=now() where org_id=$1 and approval_id=$2 and status<>'done'",[orgId,a.id]);}
  await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,$4,$5)',[orgId,a.ticket_id,String(actorId),'approval','Approval '+decision+(terminal?' · request '+status:'')]);
  return {ok:true,status,approved:count.approved,rejected:count.rejected,required:a.mode==='all'?a.approver_ids.length:1};
 });
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
