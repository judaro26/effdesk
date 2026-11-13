// Problem management is tenant-scoped and links back to existing incident tickets.
import { withOrg } from './db.js';

const clean=(v,n)=>String(v==null?'':v).replace(/\u0000/g,'').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
export const PROBLEM_STATUSES=['open','investigating','known_error','resolved','closed'];
export const PROBLEM_PRIORITIES=['P1','P2','P3','P4'];

export function normalizeProblem(input={}){
 const status=PROBLEM_STATUSES.includes(input.status)?input.status:'open';
 const priority=PROBLEM_PRIORITIES.includes(input.priority)?input.priority:'P3';
 return {
  title:clean(input.title,180),
  description:clean(input.description,5000),
  status,
  priority,
  knownError:input.knownError===true||status==='known_error',
  rootCause:clean(input.rootCause,5000),
  workaround:clean(input.workaround,5000),
  resolution:clean(input.resolution,5000),
  ownerId:clean(input.ownerId,128)
 };
}

export async function listProblems(pool,orgId,{status='',priority='',q='',limit=100}={}){
 const args=[orgId],where=['p.org_id=$1'];
 if(PROBLEM_STATUSES.includes(status)){args.push(status);where.push('p.status=$'+args.length);}
 if(PROBLEM_PRIORITIES.includes(priority)){args.push(priority);where.push('p.priority=$'+args.length);}
 const term=clean(q,160);
 if(term){args.push('%'+term+'%');where.push('(p.title ilike $'+args.length+' or p.description ilike $'+args.length+' or p.root_cause ilike $'+args.length+')');}
 args.push(Math.min(Math.max(Number(limit)||100,1),200));
 return withOrg(pool,orgId,async c=>({ok:true,problems:(await c.query(
  `select p.id,p.title,p.status,p.priority,p.known_error,p.owner_id,p.created_at,p.updated_at,p.resolved_at,
    u.name owner_name,u.email owner_email,
    count(distinct pi.ticket_id)::int incident_count,
    count(distinct pi.ticket_id) filter(where t.status in ('open','pending','on_hold'))::int active_incident_count
   from problems p
   left join "user" u on u.id=p.owner_id
   left join problem_incidents pi on pi.org_id=p.org_id and pi.problem_id=p.id
   left join tickets t on t.org_id=pi.org_id and t.id=pi.ticket_id
   where ${where.join(' and ')}
   group by p.id,u.name,u.email
   order by case p.priority when 'P1' then 0 when 'P2' then 1 when 'P3' then 2 else 3 end,
    case p.status when 'open' then 0 when 'investigating' then 1 when 'known_error' then 2 when 'resolved' then 3 else 4 end,
    p.updated_at desc limit $${args.length}`,args)).rows}));
}

export async function getProblem(pool,orgId,id){
 return withOrg(pool,orgId,async c=>{
  const problem=(await c.query(`select p.*,u.name owner_name,u.email owner_email from problems p left join "user" u on u.id=p.owner_id where p.org_id=$1 and p.id=$2`,[orgId,Number(id)||0])).rows[0];
  if(!problem)return fail('No such problem record.',404);
  const [incidents,events]=await Promise.all([
   c.query(`select t.number,t.subject,t.status,t.priority,t.updated_at,coalesce(d.severity,'P3') severity,coalesce(d.is_major,false) is_major
    from problem_incidents pi join tickets t on t.org_id=pi.org_id and t.id=pi.ticket_id
    left join incident_details d on d.org_id=t.org_id and d.ticket_id=t.id
    where pi.org_id=$1 and pi.problem_id=$2 order by t.updated_at desc`,[orgId,problem.id]),
   c.query('select id,actor_id,actor_name,event,detail,created_at from problem_events where org_id=$1 and problem_id=$2 order by created_at desc,id desc limit 100',[orgId,problem.id])
  ]);
  return {ok:true,problem,incidents:incidents.rows,events:events.rows};
 });
}

export async function saveProblem(pool,orgId,actor={},input={}){
 const d=normalizeProblem(input);
 if(!d.title)return fail('Give the problem a title.');
 const id=Number(input.id)||0;
 const incidentNumbers=[...new Set((Array.isArray(input.incidentNumbers)?input.incidentNumbers:[]).map(Number).filter(n=>Number.isSafeInteger(n)&&n>0))].slice(0,100);
 return withOrg(pool,orgId,async c=>{
  if(d.ownerId){
   const member=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2',[orgId,d.ownerId])).rows[0];
   if(!member||member.role==='light')return fail('The problem owner must be a full workspace member.');
  }
  if(incidentNumbers.length){
   const found=await c.query(`select id,number from tickets where org_id=$1 and type='incident' and number=any($2::int[])`,[orgId,incidentNumbers]);
   if(found.rowCount!==incidentNumbers.length)return fail('Every linked record must be an incident in this workspace.');
  }
  let saved, event='updated';
  if(id){
   const before=(await c.query('select status from problems where org_id=$1 and id=$2 for update',[orgId,id])).rows[0];
   if(!before)return fail('No such problem record.',404);
   const status=d.status;
   saved=(await c.query(`update problems set title=$3,description=$4,status=$5,priority=$6,known_error=$7,root_cause=$8,workaround=$9,resolution=$10,owner_id=$11,resolved_at=case when $5 in ('resolved','closed') then coalesce(resolved_at,now()) else null end,updated_at=now()
    where org_id=$1 and id=$2 returning id,status`,[orgId,id,d.title,d.description,status,d.priority,d.knownError,d.rootCause,d.workaround,d.resolution,d.ownerId||null])).rows[0];
   if(before.status!==status)event='status_changed';
  }else{
   saved=(await c.query(`insert into problems(org_id,title,description,status,priority,known_error,root_cause,workaround,resolution,owner_id,created_by,resolved_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,case when $4 in ('resolved','closed') then now() else null end) returning id,status`,
    [orgId,d.title,d.description,d.status,d.priority,d.knownError,d.rootCause,d.workaround,d.resolution,d.ownerId||null,actor.id||null])).rows[0];
   event='created';
  }
  const oldLinks=(await c.query('select ticket_id from problem_incidents where org_id=$1 and problem_id=$2',[orgId,saved.id])).rows.map(x=>Number(x.ticket_id));
  const ids=incidentNumbers.length?(await c.query(`select id from tickets where org_id=$1 and type='incident' and number=any($2::int[])`,[orgId,incidentNumbers])).rows.map(x=>Number(x.id)):[];
  await c.query('delete from problem_incidents where org_id=$1 and problem_id=$2',[orgId,saved.id]);
  for(const ticketId of ids)await c.query('insert into problem_incidents(org_id,problem_id,ticket_id) values($1,$2,$3)',[orgId,saved.id,ticketId]);
  const added=ids.filter(x=>!oldLinks.includes(x)).length,removed=oldLinks.filter(x=>!ids.includes(x)).length;
  const actorName=clean(actor.name||actor.email||actor.id,180);
  await c.query('insert into problem_events(org_id,problem_id,actor_id,actor_name,event,detail) values($1,$2,$3,$4,$5,$6)',
   [orgId,saved.id,actor.id||null,actorName,event,(event==='created'?'Problem created: ':event==='status_changed'?'Problem status changed to ':'Problem updated: ')+d.title]);
  if(added)await c.query('insert into problem_events(org_id,problem_id,actor_id,actor_name,event,detail) values($1,$2,$3,$4,$5,$6)',[orgId,saved.id,actor.id||null,actorName,'incident_linked',added+' incident(s) linked']);
  if(removed)await c.query('insert into problem_events(org_id,problem_id,actor_id,actor_name,event,detail) values($1,$2,$3,$4,$5,$6)',[orgId,saved.id,actor.id||null,actorName,'incident_unlinked',removed+' incident(s) unlinked']);
  return {ok:true,id:saved.id};
 }).then(async r=>r.ok?getProblem(pool,orgId,r.id):r);
}
