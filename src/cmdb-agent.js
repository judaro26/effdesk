// Tenant-scoped customer-installed discovery agent enrollment and inventory ingestion.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { rateLimit } from './guard.js';

const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const fail=(status,error)=>new Response(JSON.stringify({ok:false,error}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const ok=body=>new Response(JSON.stringify({ok:true,...body}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
const b64u=v=>Buffer.from(v).toString('base64url');

export async function createDiscoveryAgent(pool,orgId,actor,nameInput,provider='windows_agent'){
 if(!['windows_agent','osquery_agent','snmp_agent'].includes(provider))return {ok:false,status:400,error:'Unsupported discovery provider.'};
 const name=clean(nameInput,120);
 if(!name)return {ok:false,status:400,error:'Give this discovery agent a name.'};
 const active=await withOrg(pool,orgId,c=>c.query("select count(*)::int n from cmdb_discovery_agents where org_id=$1 and revoked_at is null and expires_at>now()",[orgId]));
 if(active.rows[0].n>=100)return {ok:false,status:400,error:'A workspace can have up to 100 active discovery agents.'};
 const id=crypto.randomUUID(),secret=crypto.randomBytes(32).toString('base64url');
 const token='edk1.'+b64u(orgId)+'.'+id+'.'+secret;
 const expiresAt=new Date(Date.now()+365*24*60*60*1000);
 const initialPlatform=provider==='windows_agent'?'windows':provider==='snmp_agent'?'network':'';
 await withOrg(pool,orgId,c=>c.query('insert into cmdb_discovery_agents(id,org_id,name,provider,platform,token_hash,created_by,expires_at) values($1,$2,$3,$4,$5,$6,$7,$8)',[id,orgId,name,provider,initialPlatform,hash(token),actor?.id||null,expiresAt]));
 return {ok:true,agent:{id,name,expiresAt},token};
}
export async function listDiscoveryAgents(pool,orgId){
 return withOrg(pool,orgId,async c=>{
  const [agents,software,softwareItems]=await Promise.all([
   c.query("select id,name,provider,platform,created_at,expires_at,revoked_at,last_seen_at,last_sync_status,last_sync_error,hostname,manufacturer,model,serial_number,os_version,software_count,network_device_count,last_network_scan_at from cmdb_discovery_agents where org_id=$1 order by created_at desc",[orgId]),
   c.query("select count(*)::int total,count(*) filter(where status='current')::int current from cmdb_discovered_software where org_id=$1",[orgId]),
   c.query("select s.name,s.publisher,s.version,s.last_seen_at,a.hostname from cmdb_discovered_software s join cmdb_discovery_agents a on a.org_id=s.org_id and a.id=s.agent_id where s.org_id=$1 and s.status='current' order by lower(s.name),s.version limit 500",[orgId])
  ]);
  return {ok:true,agents:agents.rows,software:software.rows[0],softwareItems:softwareItems.rows};
 });
}
export async function revokeDiscoveryAgent(pool,orgId,id){
 const replacement=hash(crypto.randomBytes(32).toString('base64url'));
 return withOrg(pool,orgId,async c=>{
  const r=await c.query("update cmdb_discovery_agents set revoked_at=coalesce(revoked_at,now()),token_hash=$3 where org_id=$1 and id=$2 returning id",[orgId,String(id),replacement]);
  if(!r.rowCount)return {ok:false,status:404,error:'No such discovery agent.'};
  await c.query("update configuration_items set discovery_status='disconnected',updated_at=now() where org_id=$1 and discovery_source in ('windows_agent','osquery_agent') and discovery_external_id=$2",[orgId,String(id)]);
  await c.query("update cmdb_discovered_software set status='missing' where org_id=$1 and agent_id=$2",[orgId,String(id)]);
  return {ok:true};
 });
}
function parseToken(token){
 const p=String(token||'').split('.');
 if(p.length!==4||p[0]!=='edk1')return null;
 try{
  const orgId=Buffer.from(p[1],'base64url').toString('utf8');
  if(!orgId||orgId.length>128||!p[2]||! /^[0-9a-f-]{36}$/i.test(p[2])||p[3].length<40)return null;
  return {orgId,id:p[2],token};
 }catch{return null;}
}
export function normalizeDiscoveryPayload(input){
 const d=input&&typeof input==='object'?input:{};
 const software=Array.isArray(d.software)?d.software.slice(0,500).map(x=>({
  name:clean(x?.name,240),publisher:clean(x?.publisher,180),version:clean(x?.version,100)
 })).filter(x=>x.name):[];
 return {
  hostname:clean(d.hostname,180),manufacturer:clean(d.manufacturer,120),model:clean(d.model,120),
  serial:clean(d.serial,180),osVersion:clean(d.osVersion,120),os:clean(d.os,80),
  software,
  platform:['windows','darwin','linux'].includes(clean(d.platform||'windows',16))?clean(d.platform||'windows',16):'windows',
  softwareComplete:d.softwareComplete===true
 };
}
export async function ingestDiscoveryAgent(req,{pool}){
 if(req.method!=='POST')return fail(405,'Method not allowed.');
 try{if(new URL(req.url).protocol!=='https:')return fail(400,'Discovery check-ins must use HTTPS.');}catch{return fail(400,'Invalid request URL.');}
 const auth=String(req.headers.get('authorization')||'');
 if(!auth.startsWith('Bearer ')||auth.length>512)return fail(401,'A valid discovery-agent token is required.');
 const parsed=parseToken(auth.slice(7));if(!parsed)return fail(401,'Invalid discovery-agent token.');
 if(await rateLimit(pool,'cmdb-agent:'+hash(parsed.token),10,60))return fail(429,'Too many check-ins. Please wait before retrying.');
 const raw=await req.text();if(raw.length>300000)return fail(413,'Inventory payload is too large.');
 let body;try{body=JSON.parse(raw);}catch{return fail(400,'Inventory payload must be JSON.');}
 const d=normalizeDiscoveryPayload(body);
 if(!d.hostname||!d.serial)return fail(400,'The agent must report a hostname and hardware serial number.');
 try{
  const result=await withOrg(pool,parsed.orgId,async c=>{
   const agent=(await c.query("select id,name,provider from cmdb_discovery_agents where org_id=$1 and id=$2 and token_hash=$3 and revoked_at is null and expires_at>now() for update",[parsed.orgId,parsed.id,hash(parsed.token)])).rows[0];
   if(!agent)return null;
   await c.query('select pg_advisory_xact_lock(hashtext($1))',[parsed.orgId+':discovery-agent:'+agent.id]);
   const provider=agent.provider;
   const source=provider;
   if((provider==='windows_agent'&&d.platform!=='windows')||(provider==='osquery_agent'&&!['darwin','linux'].includes(d.platform)))return null;
   const run=(await c.query("insert into cmdb_discovery_runs(org_id,provider,status) values($1,$2,'running') returning id,started_at",[parsed.orgId,provider])).rows[0];
   let ci=(await c.query("select id from configuration_items where org_id=$1 and discovery_source=$3 and discovery_external_id=$2",[parsed.orgId,String(agent.id),source])).rows[0];
   if(!ci&&!d.serial.startsWith('NO-SERIAL-')){
    const matches=await c.query("select id from configuration_items where org_id=$1 and ci_type='hardware' and serial_number=$2 and (discovery_source is null or (discovery_source in ('windows_agent','osquery_agent') and discovery_status='disconnected')) order by id limit 2",[parsed.orgId,d.serial]);
    if(matches.rows.length===1)ci=matches.rows[0];
   }
   if(ci){
    await c.query(`update configuration_items set discovery_source=$10,discovery_external_id=$3,discovery_status='current',discovery_last_seen_at=now(),
      name=case when coalesce(discovery_source,'') in ('windows_agent','osquery_agent') or name='' then $4 else name end,
      manufacturer=case when $5<>'' then $5 else manufacturer end,model=case when $6<>'' then $6 else model end,
      serial_number=$7,operating_system=$8,os_version=$9,updated_at=now() where org_id=$1 and id=$2`,
      [parsed.orgId,ci.id,String(agent.id),d.hostname,d.manufacturer,d.model,d.serial,d.os,d.osVersion,source]);
   }else{
    await c.query(`insert into configuration_items(org_id,asset_tag,name,ci_type,lifecycle,criticality,manufacturer,model,serial_number,discovery_source,discovery_external_id,discovery_status,discovery_last_seen_at,operating_system,os_version,description)
      values($1,$2,$3,'hardware','in_use','medium',$4,$5,$6,$7,$8,'current',now(),$9,$10,'Discovered by the EffDesk customer-installed agent')`,
      [parsed.orgId,(provider==='osquery_agent'?'OSQ-':'WIN-')+agent.id.toUpperCase(),d.hostname,d.manufacturer,d.model,d.serial,source,String(agent.id),d.os,d.osVersion]);
   }
   // A capped 500-row payload is not a complete snapshot, so do not mark unseen software missing in that case.
   if(d.softwareComplete&&d.software.length<500)await c.query("update cmdb_discovered_software set status='missing' where org_id=$1 and agent_id=$2",[parsed.orgId,agent.id]);
   for(const app of d.software){
    const normalized=app.name.toLowerCase().replace(/\s+/g,' ').trim();
    await c.query(`insert into cmdb_discovered_software(org_id,agent_id,name,publisher,version,normalized_name,status)
      values($1,$2,$3,$4,$5,$6,'current')
      on conflict(org_id,agent_id,normalized_name,version) do update set name=excluded.name,publisher=excluded.publisher,status='current',last_seen_at=now()`,
      [parsed.orgId,agent.id,app.name,app.publisher,app.version,normalized]);
   }
   await c.query(`update cmdb_discovery_agents set last_seen_at=now(),last_sync_status='success',last_sync_error='',hostname=$3,manufacturer=$4,model=$5,serial_number=$6,os_version=$7,software_count=$8,platform=$9 where org_id=$1 and id=$2`,
    [parsed.orgId,agent.id,d.hostname,d.manufacturer,d.model,d.serial,d.osVersion,d.software.length,d.platform]);
   await c.query("update cmdb_discovery_runs set completed_at=now(),discovered=1,created=case when $3 then 1 else 0 end,updated=case when $3 then 0 else 1 end,status='completed' where org_id=$1 and id=$2",[parsed.orgId,run.id,!ci]);
   return {agentId:agent.id,softwareCount:d.software.length};
  });
  if(!result)return fail(401,'This discovery agent has been revoked or expired.');
  return ok({receivedAt:new Date().toISOString(),softwareCount:result.softwareCount});
 }catch(e){
  console.error('Discovery agent ingestion failed:',clean(e.message,240));
  await withOrg(pool,parsed.orgId,c=>c.query("update cmdb_discovery_agents set last_sync_status='failed',last_sync_error='Inventory could not be saved.' where org_id=$1 and id=$2 and token_hash=$3 and revoked_at is null",[parsed.orgId,parsed.id,hash(parsed.token)])).catch(()=>{});
  return fail(500,'Inventory could not be saved. The agent can retry on its next run.');
 }
}
