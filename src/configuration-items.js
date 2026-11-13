// Tenant-scoped asset inventory and configuration-item relationships.
import { withOrg } from './db.js';

const clean=(v,n)=>String(v==null?'':v).replace(/\u0000/g,'').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
export const CI_TYPES=['hardware','software','application','database','network','cloud_resource','service','other'];
export const CI_LIFECYCLES=['planned','in_use','in_repair','retired','disposed'];
export const CI_CRITICALITIES=['low','medium','high','critical'];
export const CI_RELATIONSHIPS=['depends_on','runs_on','hosted_on','connects_to','managed_by'];
const validDate=v=>{if(!v)return null;const d=new Date(v);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null;};
export function normalizeConfigurationItem(input={}){
 return {
  assetTag:clean(input.assetTag,80),name:clean(input.name,180),
  ciType:CI_TYPES.includes(input.ciType)?input.ciType:'hardware',
  lifecycle:CI_LIFECYCLES.includes(input.lifecycle)?input.lifecycle:'in_use',
  criticality:CI_CRITICALITIES.includes(input.criticality)?input.criticality:'medium',
  description:clean(input.description,5000),manufacturer:clean(input.manufacturer,120),
  model:clean(input.model,120),serialNumber:clean(input.serialNumber,180),
  location:clean(input.location,240),ownerId:clean(input.ownerId,128),
  businessServiceId:Number.isSafeInteger(Number(input.businessServiceId))&&Number(input.businessServiceId)>0?Number(input.businessServiceId):null,
  purchaseDate:validDate(input.purchaseDate),warrantyExpiresAt:validDate(input.warrantyExpiresAt)
 };
}
const actorName=a=>clean(a?.name||a?.email||a?.id,180);
async function event(c,orgId,ciId,actor,type,detail){
 await c.query('insert into configuration_item_events(org_id,ci_id,actor_id,actor_name,event,detail) values($1,$2,$3,$4,$5,$6)',
 [orgId,ciId,actor?.id||null,actorName(actor),type,clean(detail,2000)]);
}
export async function listConfigurationItems(pool,orgId,{q='',lifecycle='',ciType='',limit=200}={}){
 const args=[orgId],where=['ci.org_id=$1'];
 if(CI_LIFECYCLES.includes(lifecycle)){args.push(lifecycle);where.push('ci.lifecycle=$'+args.length);}
 if(CI_TYPES.includes(ciType)){args.push(ciType);where.push('ci.ci_type=$'+args.length);}
 const term=clean(q,160);if(term){args.push('%'+term+'%');where.push('(ci.name ilike $'+args.length+' or ci.asset_tag ilike $'+args.length+' or ci.serial_number ilike $'+args.length+' or ci.manufacturer ilike $'+args.length+')');}
 args.push(Math.min(Math.max(Number(limit)||200,1),500));
 return withOrg(pool,orgId,async c=>({ok:true,items:(await c.query(`select ci.id,ci.asset_tag,ci.name,ci.ci_type,ci.lifecycle,ci.criticality,ci.manufacturer,ci.model,ci.serial_number,ci.location,ci.owner_id,ci.business_service_id,ci.warranty_expires_at,ci.created_at,ci.updated_at,u.name owner_name,u.email owner_email,bs.name service_name,
 (select count(*)::int from configuration_item_relationships r where r.org_id=ci.org_id and (r.source_ci_id=ci.id or r.target_ci_id=ci.id)) relationship_count
 from configuration_items ci left join "user" u on u.id=ci.owner_id left join business_services bs on bs.org_id=ci.org_id and bs.id=ci.business_service_id
 where ${where.join(' and ')} order by case ci.criticality when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,lower(ci.name) limit $${args.length}`,args)).rows}));
}
export async function getConfigurationItem(pool,orgId,id){
 return withOrg(pool,orgId,async c=>{
  const item=(await c.query(`select ci.*,u.name owner_name,u.email owner_email,bs.name service_name from configuration_items ci left join "user" u on u.id=ci.owner_id left join business_services bs on bs.org_id=ci.org_id and bs.id=ci.business_service_id where ci.org_id=$1 and ci.id=$2`,[orgId,Number(id)||0])).rows[0];
  if(!item)return fail('No such configuration item.',404);
  const [relationships,events,tickets,problems,changes]=await Promise.all([
   c.query(`select r.relationship,r.source_ci_id,r.target_ci_id,a.name source_name,b.name target_name from configuration_item_relationships r join configuration_items a on a.org_id=r.org_id and a.id=r.source_ci_id join configuration_items b on b.org_id=r.org_id and b.id=r.target_ci_id where r.org_id=$1 and (r.source_ci_id=$2 or r.target_ci_id=$2) order by a.name,b.name`,[orgId,item.id]),
   c.query('select id,actor_name,event,detail,created_at from configuration_item_events where org_id=$1 and ci_id=$2 order by created_at desc,id desc limit 100',[orgId,item.id]),
   c.query('select t.id,t.number,t.subject,t.status from configuration_item_tickets x join tickets t on t.org_id=x.org_id and t.id=x.ticket_id where x.org_id=$1 and x.ci_id=$2 order by t.updated_at desc limit 50',[orgId,item.id]),
   c.query('select p.id,p.title,p.status,p.priority from configuration_item_problems x join problems p on p.org_id=x.org_id and p.id=x.problem_id where x.org_id=$1 and x.ci_id=$2 order by p.updated_at desc limit 50',[orgId,item.id]),
   c.query('select ch.id,ch.title,ch.status,ch.risk from configuration_item_changes x join change_requests ch on ch.org_id=x.org_id and ch.id=x.change_id where x.org_id=$1 and x.ci_id=$2 order by ch.updated_at desc limit 50',[orgId,item.id])
  ]);
  return {ok:true,item,relationships:relationships.rows,events:events.rows,tickets:tickets.rows,problems:problems.rows,changes:changes.rows};
 });
}
export async function saveConfigurationItem(pool,orgId,actor,input={}){
 const d=normalizeConfigurationItem(input);if(!d.name)return fail('Give the asset or configuration item a name.');
 const hasId=input.id!==undefined&&input.id!==null&&input.id!=='';const id=hasId?Number(input.id):0;
 if(hasId&&(!Number.isSafeInteger(id)||id<1))return fail('Choose a valid configuration item.');
 return withOrg(pool,orgId,async c=>{
  if(d.ownerId){const m=(await c.query('select role from member where "organizationId"=$1 and "userId"=$2',[orgId,d.ownerId])).rows[0];if(!m||m.role==='light')return fail('The owner must be a full workspace member.');}
  if(d.businessServiceId&&!(await c.query('select 1 from business_services where org_id=$1 and id=$2',[orgId,d.businessServiceId])).rowCount)return fail('Choose a business service in this workspace.');
  try{
   let row;
   if(hasId){const r=await c.query(`update configuration_items set asset_tag=nullif($3,''),name=$4,ci_type=$5,lifecycle=$6,criticality=$7,description=$8,manufacturer=$9,model=$10,serial_number=$11,location=$12,owner_id=$13,business_service_id=$14,purchase_date=$15,warranty_expires_at=$16,updated_at=now() where org_id=$1 and id=$2 returning *`,[orgId,id,d.assetTag,d.name,d.ciType,d.lifecycle,d.criticality,d.description,d.manufacturer,d.model,d.serialNumber,d.location,d.ownerId||null,d.businessServiceId,d.purchaseDate,d.warrantyExpiresAt]);if(!r.rowCount)return fail('No such configuration item.',404);row=r.rows[0];await event(c,orgId,id,actor,'updated','Configuration item updated');}
   else{const r=await c.query(`insert into configuration_items(org_id,asset_tag,name,ci_type,lifecycle,criticality,description,manufacturer,model,serial_number,location,owner_id,business_service_id,purchase_date,warranty_expires_at,created_by) values($1,nullif($2,''),$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,[orgId,d.assetTag,d.name,d.ciType,d.lifecycle,d.criticality,d.description,d.manufacturer,d.model,d.serialNumber,d.location,d.ownerId||null,d.businessServiceId,d.purchaseDate,d.warrantyExpiresAt,actor?.id||null]);row=r.rows[0];await event(c,orgId,row.id,actor,'created','Configuration item created');}
   return {ok:true,item:row};
  }catch(e){if(e.code==='23505')return fail('That asset tag is already used in this workspace.');throw e;}
 });
}
export async function saveConfigurationRelationship(pool,orgId,actor,input={}){
 const source=Number(input.sourceCiId),target=Number(input.targetCiId),relationship=CI_RELATIONSHIPS.includes(input.relationship)?input.relationship:'depends_on';
 if(!Number.isSafeInteger(source)||source<1||!Number.isSafeInteger(target)||target<1||source===target)return fail('Choose two different configuration items.');
 return withOrg(pool,orgId,async c=>{
  const r=await c.query('insert into configuration_item_relationships(org_id,source_ci_id,target_ci_id,relationship,created_by) values($1,$2,$3,$4,$5) on conflict do nothing returning source_ci_id',[orgId,source,target,relationship,actor?.id||null]);
  if(!r.rowCount)return fail('That relationship already exists.');
  await event(c,orgId,source,actor,'relationship_added',relationship+' → CI #'+target);
  return {ok:true};
 });
}
const LINK_TABLE={ticket:{table:'configuration_item_tickets',column:'ticket_id',target:'tickets'},problem:{table:'configuration_item_problems',column:'problem_id',target:'problems'},change:{table:'configuration_item_changes',column:'change_id',target:'change_requests'}};
export async function linkConfigurationRecord(pool,orgId,actor,input={}){
 const kind=String(input.recordType||''),spec=LINK_TABLE[kind],ciId=Number(input.ciId),recordId=Number(input.recordId);
 if(!spec)return fail('Choose a supported record type.');
 if(!Number.isSafeInteger(ciId)||ciId<1||!Number.isSafeInteger(recordId)||recordId<1)return fail('Choose a valid configuration item and record.');
 return withOrg(pool,orgId,async c=>{
  const target=(await c.query('select id from '+spec.target+' where org_id=$1 and id=$2',[orgId,recordId])).rows[0];
  if(!target)return fail('The linked record must belong to this workspace.',404);
  const r=await c.query('insert into '+spec.table+'(org_id,ci_id,'+spec.column+') values($1,$2,$3) on conflict do nothing returning ci_id',[orgId,ciId,recordId]);
  if(!r.rowCount)return fail('That record is already linked.');
  await event(c,orgId,ciId,actor,'record_linked',kind+' #'+recordId+' linked');
  return {ok:true};
 });
}
