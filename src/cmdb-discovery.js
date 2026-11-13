// Microsoft Intune / Graph discovery for the tenant-scoped CMDB.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { seal, unseal } from './sso.js';

const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n);
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail=(status,error)=>json(status,{error});
const appBase=env=>String(env.APP_URL||'https://app.effdesk.com').replace(/\/+$/,'');
const callbackUrl=env=>appBase(env)+'/api/integrations/cmdb-discovery/oauth/callback';
const secret=env=>String(env.BETTER_AUTH_SECRET||'');
const enc=(env,v)=>seal(secret(env),v);
const dec=(env,v)=>unseal(secret(env),v);
const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const b64u=v=>Buffer.from(v).toString('base64url');
const validTenant=v=>/^[a-f0-9-]{36}$/i.test(v)||/^[a-z0-9][a-z0-9.-]{1,118}[a-z0-9]$/i.test(v);
const scopes='openid profile offline_access https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All';
async function postForm(url,body){
 const r=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams(body),signal:AbortSignal.timeout(15000),redirect:'error'});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(clean(d.error_description||d.error||'Microsoft token exchange failed ('+r.status+').',300));return d;
}
async function graphGet(url,token){
 const u=new URL(url);
 if(u.protocol!=='https:'||u.hostname!=='graph.microsoft.com')throw new Error('Microsoft Graph returned an unexpected pagination URL.');
 const r=await fetch(u,{headers:{authorization:'Bearer '+token,accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});
 if(r.status===429||r.status===503)throw new Error('Microsoft Graph is throttling requests. Please retry the sync shortly.');
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(clean(d.error?.message||'Microsoft Graph request failed ('+r.status+').',300));
 return d;
}
async function refreshToken(pool,env,org,row){
 if(row.expires_at&&new Date(row.expires_at).getTime()<Date.now()+90000){
  if(!row.refresh_token_enc)throw new Error('Microsoft authorization expired. Reconnect Intune.');
  const clientId=String(env.MICROSOFT_CLIENT_ID||''),clientSecret=String(env.MICROSOFT_CLIENT_SECRET||'');
  if(!clientId||!clientSecret)throw new Error('Microsoft OAuth app configuration is missing.');
  const refresh=dec(env,row.refresh_token_enc);
  const d=await postForm('https://login.microsoftonline.com/'+encodeURIComponent(row.tenant_id)+'/oauth2/v2.0/token',{client_id:clientId,client_secret:clientSecret,grant_type:'refresh_token',refresh_token:refresh,redirect_uri:callbackUrl(env),scope});
  const expiry=new Date(Date.now()+Number(d.expires_in||3600)*1000);
  await withOrg(pool,org,c=>c.query('update cmdb_discovery_connections set access_token_enc=$2,refresh_token_enc=$3,expires_at=$4,updated_at=now() where org_id=$1',[org,enc(env,d.access_token),d.refresh_token?enc(env,d.refresh_token):row.refresh_token_enc,expiry]));
  return d.access_token;
 }
 return dec(env,row.access_token_enc);
}
async function connection(pool,org){return withOrg(pool,org,c=>c.query('select * from cmdb_discovery_connections where org_id=$1',[org])).then(r=>r.rows[0]||null);}
export async function discoveryStatus(pool,org){
 const [conn,runs,assets]=await Promise.all([
  connection(pool,org),
  withOrg(pool,org,c=>c.query("select id,started_at,completed_at,discovered,created,updated,marked_missing,status,error from cmdb_discovery_runs where org_id=$1 order by started_at desc limit 5",[org])),
  withOrg(pool,org,c=>c.query("select count(*)::int total,count(*) filter(where discovery_status='current')::int current,count(*) filter(where discovery_status='missing')::int missing from configuration_items where org_id=$1 and discovery_source='intune'",[org]))
 ]);
 return {ok:true,configured:!!conn,tenantId:conn?.tenant_id||'',connectedAt:conn?.connected_at||null,lastSyncAt:conn?.last_sync_at||null,lastSyncCount:conn?.last_sync_count||0,lastSyncError:conn?.last_sync_error||'',assets:assets.rows[0]||{total:0,current:0,missing:0},runs:runs.rows};
}
export async function startDiscovery(pool,env,org,actor,tenantInput){
 const tenantId=clean(tenantInput,120);
 if(!validTenant(tenantId))return {ok:false,status:400,error:'Enter a valid Microsoft Entra tenant ID (GUID) or verified tenant domain.'};
 const clientId=String(env.MICROSOFT_CLIENT_ID||''),clientSecret=String(env.MICROSOFT_CLIENT_SECRET||'');
 if(!clientId||!clientSecret)return {ok:false,status:503,error:'EffDesk Microsoft OAuth app is not configured yet. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET on the deployment.'};
 if(!secret(env))return {ok:false,status:503,error:'BETTER_AUTH_SECRET is required to encrypt Microsoft credentials.'};
 const state=crypto.randomBytes(32).toString('base64url'),verifier=b64u(crypto.randomBytes(48)),challenge=b64u(crypto.createHash('sha256').update(verifier).digest());
 await pool.query('delete from cmdb_discovery_oauth_states where expires_at<now()');
 await pool.query('insert into cmdb_discovery_oauth_states(state_hash,org_id,user_id,tenant_id,verifier_enc,expires_at) values($1,$2,$3,$4,$5,now()+interval \'10 minutes\')',[hash(state),org,actor.id,tenantId,enc(env,verifier)]);
 const u=new URL('https://login.microsoftonline.com/'+encodeURIComponent(tenantId)+'/oauth2/v2.0/authorize');
 Object.entries({client_id:clientId,response_type:'code',redirect_uri:callbackUrl(env),response_mode:'query',scope,state,code_challenge:challenge,code_challenge_method:'S256',prompt:'admin_consent'}).forEach(([k,v])=>u.searchParams.set(k,v));
 return {ok:true,url:u.toString()};
}
export async function discoveryCallback(req,{pool,env=process.env}){
 const u=new URL(req.url),state=clean(u.searchParams.get('state'),200),code=clean(u.searchParams.get('code'),4000),error=clean(u.searchParams.get('error_description')||u.searchParams.get('error'),300);
 const failRedirect=msg=>Response.redirect(appBase(env)+'/desk.html?cmdbDiscovery='+encodeURIComponent(msg),302);
 if(error||!state||!code)return failRedirect(error?'authorization_failed':'invalid_callback');
 const row=(await pool.query('delete from cmdb_discovery_oauth_states where state_hash=$1 and expires_at>now() returning org_id,user_id,tenant_id,verifier_enc',[hash(state)])).rows[0];
 if(!row)return failRedirect('expired_state');
 try{
  const role=(await pool.query('select role from member where "organizationId"=$1 and "userId"=$2',[row.org_id,row.user_id])).rows[0]?.role;
  if(!['owner','admin'].includes(role))return failRedirect('membership_changed');
  const clientId=String(env.MICROSOFT_CLIENT_ID||''),clientSecret=String(env.MICROSOFT_CLIENT_SECRET||'');
  const verifier=dec(env,row.verifier_enc);
  const d=await postForm('https://login.microsoftonline.com/'+encodeURIComponent(row.tenant_id)+'/oauth2/v2.0/token',{client_id:clientId,client_secret:clientSecret,grant_type:'authorization_code',code,redirect_uri:callbackUrl(env),code_verifier:verifier,scope});
  if(!d.access_token)throw new Error('Microsoft did not return an access token.');
  const expires=new Date(Date.now()+Number(d.expires_in||3600)*1000);
  await withOrg(pool,row.org_id,c=>c.query(`insert into cmdb_discovery_connections(org_id,tenant_id,access_token_enc,refresh_token_enc,expires_at,granted_scopes,connected_by,connected_at,updated_at)
   values($1,$2,$3,$4,$5,$6,$7,now(),now()) on conflict(org_id) do update set tenant_id=excluded.tenant_id,access_token_enc=excluded.access_token_enc,refresh_token_enc=excluded.refresh_token_enc,expires_at=excluded.expires_at,granted_scopes=excluded.granted_scopes,connected_by=excluded.connected_by,connected_at=now(),last_sync_error='',updated_at=now()`,[row.org_id,row.tenant_id,enc(env,d.access_token),d.refresh_token?enc(env,d.refresh_token):null,expires,clean(d.scope||scopes,1000),row.user_id]));
  return Response.redirect(appBase(env)+'/desk.html?cmdbDiscovery=connected',302);
 }catch(e){console.error('Intune OAuth callback:',e.message);return failRedirect('authorization_failed');}
}
function normalizeDevice(d){
 const id=clean(d.id,120);if(!id)return null;
 return {id,name:clean(d.deviceName,180)||('Intune device '+id.slice(0,8)),manufacturer:clean(d.manufacturer,120),model:clean(d.model,120),serial:clean(d.serialNumber,180),os:clean(d.operatingSystem,80),osVersion:clean(d.osVersion,100),compliance:clean(d.complianceState,60),ownerType:clean(d.managedDeviceOwnerType,40),user:clean(d.userPrincipalName,254),lastSync:d.lastSyncDateTime||null};
}
export async function syncDiscovery(pool,env,org,actor){
 const row=await connection(pool,org);if(!row)return {ok:false,status:409,error:'Connect Microsoft Intune before running discovery.'};
 const run=(await withOrg(pool,org,c=>c.query("insert into cmdb_discovery_runs(org_id,status) values($1,'running') returning id,started_at",[org]))).rows[0];
 const startedAt=run.started_at;
 try{
  const token=await refreshToken(pool,env,org,row);
  const select='id,deviceName,manufacturer,model,serialNumber,operatingSystem,osVersion,complianceState,managedDeviceOwnerType,userPrincipalName,lastSyncDateTime';
  let url='https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select='+select+'&$top=100';
  let devices=[],pages=0;
  while(url){
   if(++pages>25)throw new Error('Discovery reached the 2,500-device safety limit. Narrow the Intune scope or run another sync later.');
   const data=await graphGet(url,token);
   if(Array.isArray(data.value))devices.push(...data.value);
   url=data['@odata.nextLink']||null;
   if(devices.length>2500)throw new Error('Discovery reached the 2,500-device safety limit.');
  }
  let created=0,updated=0;
  await withOrg(pool,org,async c=>{
   for(const raw of devices){
    const d=normalizeDevice(raw);if(!d)continue;
    let ci=(await c.query("select id,asset_tag from configuration_items where org_id=$1 and discovery_source='intune' and discovery_external_id=$2",[org,d.id])).rows[0];
    if(!ci&&d.serial)ci=(await c.query("select id,asset_tag from configuration_items where org_id=$1 and serial_number=$2 order by id limit 1",[org,d.serial])).rows[0];
    if(ci){
     await c.query(`update configuration_items set discovery_source='intune',discovery_external_id=$3,discovery_status='current',discovery_last_seen_at=now(),
      name=case when coalesce(discovery_source,'')='intune' or name='' then $4 else name end,
      manufacturer=case when $5<>'' then $5 else manufacturer end,model=case when $6<>'' then $6 else model end,
      serial_number=case when $7<>'' then $7 else serial_number end,operating_system=$8,os_version=$9,compliance_state=$10,updated_at=now()
      where org_id=$1 and id=$2`,[org,ci.id,d.id,d.name,d.manufacturer,d.model,d.serial,d.os,d.osVersion,d.compliance]);
     updated++;
    }else{
     const tag='INTUNE-'+d.id.slice(0,64),tagExists=(await c.query('select 1 from configuration_items where org_id=$1 and lower(asset_tag)=lower($2)',[org,tag])).rowCount;
     const inserted=await c.query(`insert into configuration_items(org_id,asset_tag,name,ci_type,lifecycle,criticality,manufacturer,model,serial_number,discovery_source,discovery_external_id,discovery_status,discovery_last_seen_at,operating_system,os_version,compliance_state,description)
      values($1,$2,$3,'hardware','in_use','medium',$4,$5,nullif($6,''),'intune',$7,'current',now(),$8,$9,$10,'Discovered from Microsoft Intune') returning id`,
      [org,tagExists?null:tag,d.name,d.manufacturer,d.model,d.serial,d.id,d.os,d.osVersion,d.compliance]);
     created++;
    }
   }
   const stale=await c.query("update configuration_items set discovery_status='missing',updated_at=now() where org_id=$1 and discovery_source='intune' and discovery_last_seen_at<$2 and discovery_status='current'",[org,startedAt]);
   await c.query("update cmdb_discovery_connections set last_sync_at=now(),last_sync_count=$2,last_sync_error='',updated_at=now() where org_id=$1",[org,devices.length]);
   await c.query("update cmdb_discovery_runs set completed_at=now(),discovered=$2,created=$3,updated=$4,marked_missing=$5,status='completed' where org_id=$1 and id=$6",[org,devices.length,created,updated,stale.rowCount,run.id]);
  });
  return {ok:true,discovered:devices.length,created,updated};
 }catch(e){
  const message=clean(e.message||'Discovery failed.',500);
  await withOrg(pool,org,async c=>{
   await c.query("update cmdb_discovery_connections set last_sync_error=$2,updated_at=now() where org_id=$1",[org,message]);
   await c.query("update cmdb_discovery_runs set completed_at=now(),status='failed',error=$3 where org_id=$1 and id=$2",[org,run.id,message]);
  }).catch(()=>{});
  return {ok:false,status:502,error:message};
 }
}
export async function disconnectDiscovery(pool,org){
 await withOrg(pool,org,async c=>{
  await c.query("update configuration_items set discovery_status='disconnected',updated_at=now() where org_id=$1 and discovery_source='intune'",[org]);
  await c.query('delete from cmdb_discovery_connections where org_id=$1',[org]);
 });
 return {ok:true};
}
