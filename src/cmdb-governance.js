// Tenant-scoped CMDB governance: license reconciliation, asset ownership and compliance policies.
import { withOrg } from './db.js';

const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const fail=(error,status=400)=>({ok:false,status,error});
const numericId=v=>Number.isSafeInteger(Number(v))&&Number(v)>0?Number(v):null;
export function normalizeSoftwareName(value){return clean(value,240).toLowerCase().replace(/\s+/g,' ').trim();}
export function normalizeComplianceRules(input={}){
 const r=input&&typeof input==='object'?input:{};
 const max=Number(r.maxDiscoveryAgeDays);
 return {
  requireOwner:r.requireOwner===true,
  requireAssetTag:r.requireAssetTag===true,
  requireSerial:r.requireSerial===true,
  requireDiscovery:r.requireDiscovery===true,
  requireWarranty:r.requireWarranty===true,
  maxDiscoveryAgeDays:Number.isInteger(max)&&max>=1&&max<=3650?max:null
 };
}
export function evaluateCompliancePolicy(policy,item,now=Date.now()){
 const r=normalizeComplianceRules(policy.rules),issues=[];
 if(r.requireOwner&&!item.owner_id)issues.push('Asset has no assigned owner.');
 if(r.requireAssetTag&&!String(item.asset_tag||'').trim())issues.push('Asset tag is required.');
 if(r.requireSerial&&!String(item.serial_number||'').trim())issues.push('Serial number is required.');
 if(r.requireDiscovery&&!item.discovery_source)issues.push('Asset has not been discovered by an approved provider.');
 if(r.requireWarranty&&(!item.warranty_expires_at||new Date(item.warranty_expires_at+'T23:59:59Z').getTime()<now))issues.push('A current warranty record is required.');
 if(r.maxDiscoveryAgeDays){
  const seen=item.discovery_last_seen_at?new Date(item.discovery_last_seen_at).getTime():0;
  if(!seen||now-seen>r.maxDiscoveryAgeDays*86400000)issues.push('Discovery check-in is older than '+r.maxDiscoveryAgeDays+' days.');
 }
 return {policyId:policy.id,policyName:policy.name,severity:policy.severity,status:issues.length?'failed':'passed',issues};
}
export async function licenseReconciliation(pool,orgId){
 return withOrg(pool,orgId,async c=>{
  const [licenses,aliases]=await Promise.all([
   c.query(`select l.id,l.product_name,l.publisher,l.license_type,l.status,l.seats_purchased,l.seats_assigned,l.ends_on,l.renewal_date,
    coalesce((select count(distinct s.agent_id)::int from cmdb_discovered_software s
      where s.org_id=l.org_id and s.status='current' and
      (s.normalized_name=lower(regexp_replace(trim(l.product_name),'\\s+',' ','g')) or exists(
       select 1 from cmdb_license_product_aliases a where a.org_id=l.org_id and a.license_id=l.id and a.normalized_name=s.normalized_name
      ))),0)::int discovered_devices
    from cmdb_software_licenses l where l.org_id=$1 order by lower(l.product_name)`,[orgId]),
   c.query('select a.id,a.license_id,a.display_name,a.normalized_name,l.product_name from cmdb_license_product_aliases a join cmdb_software_licenses l on l.org_id=a.org_id and l.id=a.license_id where a.org_id=$1 order by lower(l.product_name),lower(a.display_name)',[orgId])
  ]);
  const rows=licenses.rows.map(x=>({...x,observed_seats:Number(x.discovered_devices)||0,potential_overage:Math.max(0,(Number(x.discovered_devices)||0)-Number(x.seats_purchased||0)),unused_seats:Math.max(0,Number(x.seats_purchased||0)-(Number(x.discovered_devices)||0)),expired:x.ends_on?new Date(x.ends_on+'T23:59:59Z').getTime()<Date.now():false}));
  return {ok:true,licenses:rows,aliases:aliases.rows,summary:{licenses:rows.length,overLimit:rows.filter(x=>x.potential_overage>0).length,unusedSeats:rows.reduce((n,x)=>n+x.unused_seats,0)}};
 });
}
export async function saveLicenseAlias(pool,orgId,actor,b={}){
 const licenseId=numericId(b.licenseId),displayName=clean(b.softwareName,240),normalizedName=normalizeSoftwareName(displayName);
 if(!licenseId||!normalizedName)return fail('Choose a license and enter the discovered software name.');
 return withOrg(pool,orgId,async c=>{
  const exists=await c.query('select id from cmdb_software_licenses where org_id=$1 and id=$2',[orgId,licenseId]);
  if(!exists.rowCount)return fail('Choose a software license in this workspace.',404);
  try{
   const q=await c.query(`insert into cmdb_license_product_aliases(org_id,license_id,normalized_name,display_name,created_by)
    values($1,$2,$3,$4,$5) on conflict(org_id,license_id,normalized_name) do update set display_name=excluded.display_name returning id,license_id,normalized_name,display_name`,
    [orgId,licenseId,normalizedName,displayName,actor?.id||null]);
   return {ok:true,alias:q.rows[0]};
  }catch(e){if(e.code==='23505')return fail('That software alias is already mapped to another license.');throw e;}
 });
}
export async function assetOwnershipReport(pool,orgId){
 return withOrg(pool,orgId,async c=>{
  const [summary,items]=await Promise.all([
   c.query(`select count(*)::int total,count(*) filter(where owner_id is not null)::int assigned,
    count(*) filter(where owner_id is null)::int unassigned from configuration_items where org_id=$1`,[orgId]),
   c.query(`select ci.id,ci.asset_tag,ci.name,ci.ci_type,ci.criticality,ci.owner_id,u.name owner_name,u.email owner_email
    from configuration_items ci left join "user" u on u.id=ci.owner_id
    where ci.org_id=$1 order by (ci.owner_id is null) desc,lower(ci.name) limit 1000`,[orgId])
  ]);
  const owners=new Map();
  for(const x of items.rows){if(!x.owner_id)continue;const k=String(x.owner_id);if(!owners.has(k))owners.set(k,{ownerId:x.owner_id,name:x.owner_name||x.owner_email||'Workspace member',email:x.owner_email||'',assetCount:0});owners.get(k).assetCount++;}
  return {ok:true,summary:summary.rows[0],owners:[...owners.values()].sort((a,b)=>b.assetCount-a.assetCount),items:items.rows};
 });
}
export async function assignAssetOwner(pool,orgId,actor,b={}){
 const ids=[...new Set((Array.isArray(b.assetIds)?b.assetIds:[]).map(numericId).filter(Boolean))].slice(0,100),ownerId=b.ownerId?clean(b.ownerId,128):null;
 if(!ids.length)return fail('Select at least one asset (up to 100 at a time).');
 return withOrg(pool,orgId,async c=>{
  if(ownerId){const m=await c.query('select 1 from member where "organizationId"=$1 and "userId"=$2',[orgId,ownerId]);if(!m.rowCount)return fail('Choose a member of this workspace.',404);}
  const q=await c.query('update configuration_items set owner_id=$3,updated_at=now() where org_id=$1 and id=any($2::bigint[]) returning id,name',[orgId,ids,ownerId]);
  return {ok:true,updated:q.rowCount,items:q.rows};
 });
}
export async function listCompliancePolicies(pool,orgId){
 return withOrg(pool,orgId,c=>c.query('select id,name,description,enabled,severity,rules,created_at,updated_at from cmdb_compliance_policies where org_id=$1 order by lower(name)',[orgId]).then(r=>({ok:true,policies:r.rows})));
}
export async function saveCompliancePolicy(pool,orgId,actor,b={}){
 const name=clean(b.name,160),description=clean(b.description,1000),severity=['low','medium','high','critical'].includes(b.severity)?b.severity:'high',rules=normalizeComplianceRules(b.rules);
 if(!name)return fail('Policy name is required.');
 if(!Object.values(rules).some(v=>v===true||typeof v==='number'))return fail('Enable at least one compliance rule.');
 return withOrg(pool,orgId,async c=>{
  try{
   const q=b.id?await c.query('update cmdb_compliance_policies set name=$3,description=$4,enabled=$5,severity=$6,rules=$7::jsonb,updated_at=now() where org_id=$1 and id=$2 returning *',
    [orgId,numericId(b.id),name,description,b.enabled!==false,severity,JSON.stringify(rules)]):
    await c.query('insert into cmdb_compliance_policies(org_id,name,description,enabled,severity,rules,created_by) values($1,$2,$3,$4,$5,$6::jsonb,$7) returning *',
    [orgId,name,description,b.enabled!==false,severity,JSON.stringify(rules),actor?.id||null]);
   return q.rowCount?{ok:true,policy:q.rows[0]}:fail('Compliance policy not found.',404);
  }catch(e){if(e.code==='23505')return fail('A policy with that name already exists.');throw e;}
 });
}
export async function evaluateCompliance(pool,orgId){
 return withOrg(pool,orgId,async c=>{
  const [policies,items]=await Promise.all([
   c.query('select id,name,severity,rules from cmdb_compliance_policies where org_id=$1 and enabled=true order by id',[orgId]),
   c.query('select id,asset_tag,name,ci_type,owner_id,serial_number,warranty_expires_at,discovery_source,discovery_last_seen_at from configuration_items where org_id=$1 order by lower(name) limit 2000',[orgId])
  ]);
  const results=items.rows.map(item=>{
   const evaluations=policies.rows.map(policy=>evaluateCompliancePolicy(policy,item));
   const failures=evaluations.filter(x=>x.status==='failed');
   return {itemId:item.id,name:item.name,assetTag:item.asset_tag,ownerId:item.owner_id,status:failures.length?'failed':'passed',failedPolicies:failures.length,issues:failures};
  });
  return {ok:true,policies:policies.rows.length,assets:results.length,passed:results.filter(x=>x.status==='passed').length,failed:results.filter(x=>x.status==='failed').length,results};
 });
}
