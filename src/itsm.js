// ITSM incident management builds on existing tickets; it does not create a second ticket system.
import { withOrg } from './db.js';

const clean=(v,n)=>String(v==null?'':v).replace(/\u0000/g,'').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
export const INCIDENT_IMPACTS=['low','medium','high','critical'];
export const INCIDENT_URGENCIES=['low','medium','high','critical'];
export const INCIDENT_SEVERITIES=['P1','P2','P3','P4'];
export const SERVICE_CRITICALITIES=['low','medium','high','critical'];
export const SERVICE_STATES=['operational','degraded','outage','maintenance','retired'];
export function normalizeIncident(input={}){
 const severity=INCIDENT_SEVERITIES.includes(input.severity)?input.severity:'P3';
 return {
  impact:INCIDENT_IMPACTS.includes(input.impact)?input.impact:'medium',
  urgency:INCIDENT_URGENCIES.includes(input.urgency)?input.urgency:'medium',
  severity,isMajor:input.isMajor===true,
  commanderId:clean(input.commanderId,128),
  publicSummary:clean(input.publicSummary,3000),
  internalSummary:clean(input.internalSummary,5000),
  nextUpdateAt:input.nextUpdateAt&&Number.isFinite(new Date(input.nextUpdateAt).getTime())?new Date(input.nextUpdateAt):null
 };
}
export async function listServices(pool,orgId){
 return withOrg(pool,orgId,async c=>({ok:true,services:(await c.query(`select s.id,s.name,s.description,s.owner_id,s.criticality,s.status,s.created_at,s.updated_at,u.name owner_name,u.email owner_email from business_services s left join "user" u on u.id=s.owner_id where s.org_id=$1 order by case s.criticality when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,lower(s.name)`,[orgId])).rows}));
}
export async function saveService(pool,orgId,input={}){
 const name=clean(input.name,120),description=clean(input.description,2000);
 if(!name)return fail('Give the service a name.');
 const criticality=SERVICE_CRITICALITIES.includes(input.criticality)?input.criticality:'medium';
 const status=SERVICE_STATES.includes(input.status)?input.status:'operational';
 const ownerId=clean(input.ownerId,128)||null;
 return withOrg(pool,orgId,async c=>{
  if(ownerId&&!(await c.query('select 1 from member where "organizationId"=$1 and "userId"=$2',[orgId,ownerId])).rowCount)return fail('The service owner must be a member of this workspace.');
  if(input.id){
   const r=await c.query('update business_services set name=$3,description=$4,owner_id=$5,criticality=$6,status=$7,updated_at=now() where org_id=$1 and id=$2 returning id,name,description,owner_id,criticality,status,created_at,updated_at',[orgId,Number(input.id),name,description,ownerId,criticality,status]);
   return r.rowCount?{ok:true,service:r.rows[0]}:fail('No such service.',404);
  }
  try{
   const r=await c.query('insert into business_services(org_id,name,description,owner_id,criticality,status) values($1,$2,$3,$4,$5,$6) returning id,name,description,owner_id,criticality,status,created_at,updated_at',[orgId,name,description,ownerId,criticality,status]);
   return {ok:true,service:r.rows[0]};
  }catch(e){if(e.code==='23505')return fail('A service with that name already exists.');throw e;}
 });
}
export async function listIncidents(pool,orgId,{status='',severity='',majorOnly=false,limit=100}={}){
 const args=[orgId],where=['t.org_id=$1','t.type=\'incident\''];
 if(['open','pending','on_hold','solved','closed'].includes(status)){args.push(status);where.push('t.status=$'+args.length);}
 if(INCIDENT_SEVERITIES.includes(severity)){args.push(severity);where.push('coalesce(d.severity,\'P3\')=$'+args.length);}
 if(majorOnly){where.push('coalesce(d.is_major,false)=true');}
 args.push(Math.min(Math.max(Number(limit)||100,1),200));
 return withOrg(pool,orgId,async c=>({ok:true,incidents:(await c.query(`select t.id,t.number,t.subject,t.status,t.priority,t.requester_name,t.requester_email,t.assignee_id,t.created_at,t.updated_at,coalesce(d.impact,'medium') impact,coalesce(d.urgency,'medium') urgency,coalesce(d.severity,'P3') severity,coalesce(d.is_major,false) is_major,d.commander_id,d.next_update_at,d.resolved_at,(select count(*)::int from incident_services x where x.org_id=t.org_id and x.ticket_id=t.id) affected_services from tickets t left join incident_details d on d.org_id=t.org_id and d.ticket_id=t.id where ${where.join(' and ')} order by case coalesce(d.severity,'P3') when 'P1' then 0 when 'P2' then 1 when 'P3' then 2 else 3 end,t.updated_at desc limit $${args.length}`,args)).rows}));
}
export async function getIncident(pool,orgId,number){
 return withOrg(pool,orgId,async c=>{
  const t=(await c.query(`select t.id,t.number,t.subject,t.status,t.priority,t.requester_name,t.requester_email,t.assignee_id,t.created_at,t.updated_at,d.impact,d.urgency,d.severity,d.is_major,d.commander_id,d.public_summary,d.internal_summary,d.next_update_at,d.resolved_at from tickets t left join incident_details d on d.org_id=t.org_id and d.ticket_id=t.id where t.org_id=$1 and t.number=$2 and t.type='incident'`,[orgId,Number(number)||0])).rows[0];
  if(!t)return fail('No such incident ticket.',404);
  const [services,relations]=await Promise.all([
   c.query('select s.id,s.name,s.criticality,s.status from incident_services x join business_services s on s.org_id=x.org_id and s.id=x.service_id where x.org_id=$1 and x.ticket_id=$2 order by lower(s.name)',[orgId,t.id]),
   c.query(`select t.number,t.subject,t.status,r.relation from incident_relations r join tickets t on t.org_id=r.org_id and t.id=r.related_ticket_id where r.org_id=$1 and r.ticket_id=$2 order by t.number`,[orgId,t.id])
  ]);
  return {ok:true,incident:t,services:services.rows,related:relations.rows};
 });
}
export async function saveIncident(pool,orgId,actorId,input={}){
 const number=Number(input.number);if(!Number.isSafeInteger(number)||number<1)return fail('Choose a valid incident ticket.');
 const d=normalizeIncident(input),serviceIds=[...new Set((Array.isArray(input.serviceIds)?input.serviceIds:[]).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0))].slice(0,50);
 const relatedNumbers=[...new Set((Array.isArray(input.relatedNumbers)?input.relatedNumbers:[]).map(Number).filter(x=>Number.isSafeInteger(x)&&x>0&&x!==number))].slice(0,50);
 return withOrg(pool,orgId,async c=>{
  const t=(await c.query(`select id,number,type,status from tickets where org_id=$1 and number=$2 for update`,[orgId,number])).rows[0];
  if(!t||t.type!=='incident')return fail('This ticket is not an incident. Change its ticket type to Incident first.',404);
  if(d.commanderId){
   const m=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2',[orgId,d.commanderId])).rows[0];
   if(!m||m.role==='light')return fail('The incident commander must be a full workspace member.');
  }
  if(serviceIds.length){const found=await c.query('select id from business_services where org_id=$1 and id=any($2::bigint[])',[orgId,serviceIds]);if(found.rowCount!==serviceIds.length)return fail('One or more affected services do not belong to this workspace.');}
  if(relatedNumbers.length){const found=await c.query(`select id,number from tickets where org_id=$1 and type='incident' and number=any($2::int[])`,[orgId,relatedNumbers]);if(found.rowCount!==relatedNumbers.length)return fail('Related records must be incident tickets in this workspace.');}
  await c.query(`insert into incident_details(org_id,ticket_id,impact,urgency,severity,is_major,commander_id,public_summary,internal_summary,next_update_at,resolved_at)
   values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,case when $11='closed' then now() else null end)
   on conflict(org_id,ticket_id) do update set impact=excluded.impact,urgency=excluded.urgency,severity=excluded.severity,is_major=excluded.is_major,commander_id=excluded.commander_id,public_summary=excluded.public_summary,internal_summary=excluded.internal_summary,next_update_at=excluded.next_update_at,resolved_at=case when $11='closed' then coalesce(incident_details.resolved_at,now()) else null end,updated_at=now()`,
   [orgId,t.id,d.impact,d.urgency,d.severity,d.isMajor,d.commanderId||null,d.publicSummary,d.internalSummary,d.nextUpdateAt,t.status]);
  await c.query('delete from incident_services where org_id=$1 and ticket_id=$2',[orgId,t.id]);
  for(const sid of serviceIds)await c.query('insert into incident_services(org_id,ticket_id,service_id) values($1,$2,$3)',[orgId,t.id,sid]);
  await c.query('delete from incident_relations where org_id=$1 and ticket_id=$2',[orgId,t.id]);
  for(const related of relatedNumbers){
   const other=(await c.query('select id from tickets where org_id=$1 and number=$2 and type=\'incident\'', [orgId,related])).rows[0];
   await c.query('insert into incident_relations(org_id,ticket_id,related_ticket_id,relation) values($1,$2,$3,\'related\') on conflict do nothing',[orgId,t.id,other.id]);
  }
  await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,$4,$5)',[orgId,t.id,String(actorId),'incident','Incident details updated · '+d.severity+(d.isMajor?' · Major incident':'')]);
  return getIncident(pool,orgId,number);
 });
}
