// Tenant-scoped monitoring alert ingestion for Datadog, Grafana, Splunk, and Sentry.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { ensureContact } from './contacts.js';

const PROVIDERS=new Set(['datadog','grafana','splunk','sentry']);
const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const digest=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail=(status,error)=>json(status,{error});
const first=(...v)=>v.find(x=>x!==undefined&&x!==null&&String(x).trim()!=='');
const safeUrl=v=>{try{const u=new URL(String(v||''));return u.protocol==='https:'&&!u.username&&!u.password?u.toString():'';}catch{return '';}};

export async function listMonitoringAlertConnections(pool,orgId){
 return withOrg(pool,orgId,async c=>({ok:true,connections:(await c.query('select id,provider,name,active,last_status,last_at,last_error,created_at from monitoring_alert_connections where org_id=$1 order by provider,name',[orgId])).rows}));
}
export async function createMonitoringAlertConnection(pool,orgId,actorId,input={}){
 const provider=clean(input.provider,30).toLowerCase(),name=clean(input.name,100);
 if(!PROVIDERS.has(provider))return {ok:false,status:400,error:'Choose Datadog, Grafana, Splunk, or Sentry.'};
 if(!name)return {ok:false,status:400,error:'Give this alert webhook a name.'};
 const secret='effalert_'+crypto.randomBytes(32).toString('base64url'),tokenHash=digest(secret);
 let row;
 try{
  row=await withOrg(pool,orgId,async c=>{
   const count=await c.query('select count(*)::int n from monitoring_alert_connections where org_id=$1 and provider=$2 and active=true',[orgId,provider]);
   if(count.rows[0].n)return null;
   const saved=(await c.query('insert into monitoring_alert_connections(org_id,provider,name,created_by) values($1,$2,$3,$4) returning id',[orgId,provider,name,actorId])).rows[0];
   await c.query('insert into monitoring_alert_token_registry(token_hash,org_id,connection_id,provider) values($1,$2,$3,$4)',[tokenHash,orgId,saved.id,provider]);
   return saved;
  });
 }catch(e){if(e.code==='23505')return {ok:false,status:409,error:'This workspace already has an active '+provider+' alert webhook.'};throw e;}
 if(!row)return {ok:false,status:409,error:'This workspace already has an active '+provider+' alert webhook. Revoke it before creating another.'};
 return {ok:true,connection:{id:row.id,provider,name},secret};
}
export async function revokeMonitoringAlertConnection(pool,orgId,id){
 return withOrg(pool,orgId,async c=>{
  const row=(await c.query('update monitoring_alert_connections set active=false,updated_at=now() where org_id=$1 and id=$2 and active=true returning id',[orgId,Number(id)||0])).rows[0];
  if(!row)return {ok:false,status:404,error:'Active alert webhook not found.'};
  await c.query('update monitoring_alert_token_registry set active=false where org_id=$1 and connection_id=$2',[orgId,row.id]);
  return {ok:true};
 });
}

function normalize(provider,body,raw){
 let rows=[];
 if(provider==='grafana')rows=Array.isArray(body.alerts)?body.alerts.slice(0,100):[body];
 else if(provider==='sentry')rows=[body.data?.issue||body.issue||body.data?.event||body];
 else if(provider==='splunk')rows=[body.result||body];
 else rows=[body];
 return rows.map((item,index)=>{
  const labels=item.labels||{},annotations=item.annotations||{},data=item.data||{},issue=item.issue||item;
  const title=clean(first(
   provider==='grafana'?labels.alertname:undefined,
   provider==='grafana'?annotations.summary:undefined,
   provider==='sentry'?issue.title:undefined,
   item.title,item.name,item.search_name,item.alert_name,item.monitor_name,
   provider==='sentry'?issue.culprit:undefined,
   provider+' alert'
  ),200);
  const key=clean(first(
   provider==='grafana'?item.fingerprint:undefined,
   provider==='sentry'?issue.id:undefined,
   item.alert_id,item.monitor_id,item.savedsearch_id,item.search_id,
   provider==='datadog'?(String(item.title||'')+'|'+String(item.host||'')+'|'+String(item.monitor_name||'')):undefined,
   provider==='splunk'?(String(item.search_name||'')+'|'+String(item.alert_name||'')):undefined,
   provider==='grafana'?(String(labels.alertname||title)+'|'+String(labels.instance||labels.host||'')):undefined,
   provider==='sentry'?issue.shortId:undefined,
   digest(title+'|'+String(item.host||labels.host||labels.instance||''))
  ),200);
  const statusRaw=clean(first(item.status,item.state,item.alert_transition,item.action,body.status,body.action),'100').toLowerCase();
  const resolved=/resolv|recover|closed|normal|clear|fixed|regression_end/.test(statusRaw);
  const acknowledged=/acknowledg|assign|muted/.test(statusRaw);
  const ticketStatus=resolved?'solved':acknowledged?'pending':'open';
  const severityRaw=clean(first(item.severity,item.priority,item.level,labels.severity,annotations.severity,item.alert_type),'80').toLowerCase();
  const sev1=/fatal|critical|emergency|sev[- ]?1|p1/.test(severityRaw);
  const sev2=/error|high|sev[- ]?2|p2|urgent/.test(severityRaw);
  const sev4=/info|informational|low|sev[- ]?4|p4/.test(severityRaw);
  const severity=sev1?'P1':sev2?'P2':sev4?'P4':'P3';
  const priority=sev1?'urgent':sev2?'high':sev4?'low':'normal';
  const impact=sev1?'critical':sev2?'high':sev4?'low':'medium';
  const message=clean(first(item.text,item.message,annotations.description,item.description,item.culprit,item.summary,data.message),'4000');
  const url=safeUrl(first(item.url,item.permalink,item.generatorURL,item.dashboardURL,item.link,issue.permalink));
  const eventId=clean(first(body.event_id,body.delivery_id,body.webhook_id,provider==='sentry'?body.id:undefined),200)||digest(raw+'|'+key+'|'+statusRaw+'|'+index);
  return {key,title,statusRaw,ticketStatus,severity,priority,impact,message,url,eventId};
 }).filter(x=>x.key&&x.title);
}

async function applyAlert(pool,orgId,provider,alert){
 return withOrg(pool,orgId,async c=>{
  await c.query('select pg_advisory_xact_lock(hashtext($1))',[orgId+':alert:'+provider+':'+alert.key]);
  const event=await c.query('insert into monitoring_alert_events(org_id,provider,event_id,external_alert_key) values($1,$2,$3,$4) on conflict do nothing returning event_id',[orgId,provider,alert.eventId,alert.key]);
  if(!event.rowCount)return {duplicate:true};
  let link=(await c.query('select l.ticket_id,t.number,t.status,t.priority,t.subject from monitoring_alert_links l join tickets t on t.org_id=l.org_id and t.id=l.ticket_id where l.org_id=$1 and l.provider=$2 and l.external_alert_key=$3 for update of l,t',[orgId,provider,alert.key])).rows[0];
  let created=false;
  if(!link){
   const email=provider+'@alerts.effdesk.com',requester=provider==='datadog'?'Datadog':provider==='grafana'?'Grafana':provider==='splunk'?'Splunk':'Sentry';
   const n=(await c.query('insert into ticket_counters(org_id,last_number) values($1,1) on conflict(org_id) do update set last_number=ticket_counters.last_number+1 returning last_number',[orgId])).rows[0].last_number;
   await ensureContact(c,orgId,{email,name:requester,companyId:null});
   const ticket=(await c.query(`insert into tickets(org_id,number,subject,status,priority,channel,requester_name,requester_email,tags,custom,type,solved_at)
    values($1,$2,$3,$4,$5,'api',$6,$7,$8,'{}'::jsonb,'incident',case when $4 in ('solved','closed') then now() else null end)
    returning id,number,status,priority,subject`,
    [orgId,n,alert.title,alert.ticketStatus,alert.priority,requester,email,['monitoring-alert',provider]])).rows[0];
   await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body) values($1,$2,\'note\',null,$3,$4)',[orgId,ticket.id,requester,alert.message||('Alert received from '+requester+'.')]);
   await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,\'incident\',$4)',[orgId,ticket.id,requester,'Monitoring alert imported · '+alert.severity]);
   link=ticket;created=true;
   await c.query('insert into monitoring_alert_links(org_id,provider,external_alert_key,ticket_id,external_url,external_status,external_severity,last_event_at) values($1,$2,$3,$4,$5,$6,$7,now())',[orgId,provider,alert.key,ticket.id,alert.url||null,alert.statusRaw,alert.severity]);
  }else{
   const changed=link.status!==alert.ticketStatus||link.priority!==alert.priority||link.subject!==alert.title;
   await c.query(`update tickets set subject=$3,status=$4,priority=$5,solved_at=case when $4 in ('solved','closed') then coalesce(solved_at,now()) else null end,updated_at=now() where org_id=$1 and id=$2`,
    [orgId,link.ticket_id,alert.title,alert.ticketStatus,alert.priority]);
   if(changed)await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,\'incident\',$4)',[orgId,provider,provider+' alert update · '+alert.statusRaw+' · '+alert.severity]);
   if(changed&&alert.message)await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body) values($1,$2,\'note\',null,$3,$4)',[orgId,link.ticket_id,provider,alert.message]);
   await c.query('update monitoring_alert_links set external_url=coalesce($4,external_url),external_status=$5,external_severity=$6,last_event_at=now(),updated_at=now() where org_id=$1 and provider=$2 and external_alert_key=$3',[orgId,provider,alert.key,alert.url||null,alert.statusRaw,alert.severity]);
  }
  await c.query(`insert into incident_details(org_id,ticket_id,impact,urgency,severity,is_major)
   values($1,$2,$3,$3,$4,$5)
   on conflict(org_id,ticket_id) do update set impact=excluded.impact,urgency=excluded.urgency,severity=excluded.severity,is_major=excluded.is_major,updated_at=now()`,
   [orgId,link.ticket_id,alert.impact,alert.severity,alert.severity==='P1'||alert.severity==='P2']);
  return {duplicate:false,created,ticketNumber:link.number,providerAlertKey:alert.key};
 });
}

export async function receiveMonitoringAlertWebhook(req,{pool,provider,token}){
 if(req.method!=='POST'||!PROVIDERS.has(provider))return fail(404,'Unknown monitoring alert webhook.');
 if(!token||token.length<30||token.length>150)return fail(404,'Unknown monitoring alert webhook.');
 const raw=await req.text();if(raw.length>500000)return fail(413,'Webhook payload is too large.');
 let body;try{body=JSON.parse(raw);}catch{return fail(400,'Invalid JSON payload.');}
 const alerts=normalize(provider,body,raw);if(!alerts.length)return fail(400,'No recognizable alert was found in the payload.');
 const auth=(await pool.query('select org_id,connection_id from monitoring_alert_token_registry where provider=$1 and token_hash=$2 and active=true',[provider,digest(token)])).rows[0];
 if(!auth)return fail(401,'Invalid or revoked webhook secret.');
 try{
  const results=[];
  for(const alert of alerts)results.push(await applyAlert(pool,auth.org_id,provider,alert));
  await withOrg(pool,auth.org_id,c=>c.query('update monitoring_alert_connections set last_status=$3,last_at=now(),last_error=null,updated_at=now() where org_id=$1 and id=$2',[auth.org_id,auth.connection_id,results.every(x=>x.duplicate)?'duplicate':'received']));
  return json(200,{ok:true,received:results.length,created:results.filter(x=>x.created).length,duplicates:results.filter(x=>x.duplicate).length,alerts:results});
 }catch(e){
  await withOrg(pool,auth.org_id,c=>c.query('update monitoring_alert_connections set last_status=\'error\',last_at=now(),last_error=$3,updated_at=now() where org_id=$1 and id=$2',[auth.org_id,auth.connection_id,clean(e.message,500)])).catch(()=>{});
  console.error('monitoring alert webhook:',provider,e.message);
  return fail(500,'Alert processing failed.');
 }
}
