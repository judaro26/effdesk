// Read-only SNMPv3 network inventory ingestion from an explicitly authorized customer-side poller.
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { withOrg } from './db.js';
import { rateLimit } from './guard.js';

const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const fail=(status,error)=>new Response(JSON.stringify({ok:false,error}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const ok=body=>new Response(JSON.stringify({ok:true,...body}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
function parseToken(token){
 const p=String(token||'').split('.');
 if(p.length!==4||p[0]!=='edk1')return null;
 try{const orgId=Buffer.from(p[1],'base64url').toString('utf8');if(!orgId||orgId.length>128||!p[2]||! /^[0-9a-f-]{36}$/i.test(p[2])||p[3].length<40)return null;return {orgId,id:p[2],token};}catch{return null;}
}
function privateAddress(ip){
 if(isIP(ip)===4){const a=ip.split('.').map(Number);return a[0]===10||(a[0]===172&&a[1]>=16&&a[1]<=31)||(a[0]===192&&a[1]===168);}
 if(isIP(ip)===6){const s=ip.toLowerCase();return s.startsWith('fc')||s.startsWith('fd')||s.startsWith('fe80:');}
 return false;
}
export function normalizeSnmpDevices(input){
 const devices=Array.isArray(input?.devices)?input.devices.slice(0,1024):[];
 return devices.map(d=>({ip:clean(d?.ip,64),name:clean(d?.sysName,180),description:clean(d?.sysDescr,500),objectId:clean(d?.sysObjectId,180),uptime:clean(d?.sysUpTime,120)}))
  .filter(d=>privateAddress(d.ip)&&d.name||privateAddress(d.ip)&&d.description);
}
export async function ingestSnmpDiscoveryAgent(req,{pool}){
 if(req.method!=='POST')return fail(405,'Method not allowed.');
 try{if(new URL(req.url).protocol!=='https:')return fail(400,'SNMP discovery check-ins must use HTTPS.');}catch{return fail(400,'Invalid request URL.');}
 const auth=String(req.headers.get('authorization')||'');if(!auth.startsWith('Bearer ')||auth.length>512)return fail(401,'A valid discovery-agent token is required.');
 const parsed=parseToken(auth.slice(7));if(!parsed)return fail(401,'Invalid discovery-agent token.');
 if(await rateLimit(pool,'cmdb-snmp-agent:'+hash(parsed.token),5,60))return fail(429,'Too many network discovery check-ins. Please wait before retrying.');
 const raw=await req.text();if(raw.length>300000)return fail(413,'Network inventory payload is too large.');
 let body;try{body=JSON.parse(raw);}catch{return fail(400,'Network inventory payload must be JSON.');}
 if(!Array.isArray(body.devices)||body.devices.length>1024)return fail(400,'A scan must contain no more than 1,024 device results.');
 const devices=normalizeSnmpDevices(body);
 if(!devices.length)return fail(400,'No valid private-network SNMP device results were supplied.');
 try{
  const result=await withOrg(pool,parsed.orgId,async c=>{
   const agent=(await c.query("select id,name,provider from cmdb_discovery_agents where org_id=$1 and id=$2 and token_hash=$3 and revoked_at is null and expires_at>now() for update",[parsed.orgId,parsed.id,hash(parsed.token)])).rows[0];
   if(!agent||agent.provider!=='snmp_agent')return null;
   await c.query('select pg_advisory_xact_lock(hashtext($1))',[parsed.orgId+':snmp-agent:'+agent.id]);
   const run=(await c.query("insert into cmdb_discovery_runs(org_id,provider,status) values($1,'snmp_agent','running') returning id",[parsed.orgId])).rows[0];
   let created=0,updated=0;
   for(const d of devices){
    const externalId=agent.id+':'+d.ip;
    const prior=(await c.query("select id from configuration_items where org_id=$1 and discovery_source='snmp_agent' and discovery_external_id=$2",[parsed.orgId,externalId])).rows[0];
    const name=d.name||d.description.slice(0,180)||d.ip;
    const metadata={network:{ip:d.ip,sysDescr:d.description,sysObjectID:d.objectId,sysName:d.name,sysUpTime:d.uptime,protocol:'SNMPv3 authPriv'}};
    if(prior){
     await c.query("update configuration_items set name=$3,ci_type='network',manufacturer='',model='',operating_system='Network device',os_version=$4,metadata=coalesce(metadata,'{}'::jsonb)||$5::jsonb,discovery_status='current',discovery_last_seen_at=now(),updated_at=now() where org_id=$1 and id=$2",[parsed.orgId,prior.id,name,d.description,JSON.stringify(metadata)]);
     updated++;
    }else{
     const tag='SNMP-'+agent.id.replace(/-/g,'').slice(0,8).toUpperCase()+'-'+d.ip.replace(/[^0-9a-f]/gi,'-');
     await c.query("insert into configuration_items(org_id,asset_tag,name,ci_type,lifecycle,criticality,operating_system,os_version,discovery_source,discovery_external_id,discovery_status,discovery_last_seen_at,metadata,description) values($1,$2,$3,'network','in_use','medium','Network device',$4,'snmp_agent',$5,'current',now(),$6::jsonb,'Discovered through authorized SNMPv3 read-only polling')",[parsed.orgId,tag,name,d.description,externalId,JSON.stringify(metadata)]);
     created++;
    }
   }
   await c.query("update cmdb_discovery_agents set last_seen_at=now(),last_sync_status='success',last_sync_error='',network_device_count=$3,last_network_scan_at=now(),platform='network' where org_id=$1 and id=$2",[parsed.orgId,agent.id,devices.length]);
   await c.query("update cmdb_discovery_runs set completed_at=now(),discovered=$3,created=$4,updated=$5,status='completed' where org_id=$1 and id=$2",[parsed.orgId,run.id,devices.length,created,updated]);
   return {discovered:devices.length,created,updated};
  });
  if(!result)return fail(401,'Discovery agent is invalid, expired, revoked or not an SNMP network poller.');
  return ok(result);
 }catch(e){return fail(500,'Network inventory could not be saved.');}
}
