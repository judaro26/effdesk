// Tenant-scoped inbound incident event adapters for PagerDuty, Rootly, and FireHydrant.
// Provider webhook URLs contain a high-entropy one-time secret; only its SHA-256 digest is stored.
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { ensureContact } from './contacts.js';

const PROVIDERS = new Set(['pagerduty','rootly','firehydrant']);
const clean = (v,n=500) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n);
const digest = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const json = (status,body) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const first = (...values) => values.find(v => v !== undefined && v !== null && String(v).trim() !== '');
const responseError = (status,error) => json(status,{error});
const safeExternalUrl = value => { try { const u=new URL(String(value||'')); return u.protocol==='https:'&&!u.username&&!u.password?u.toString():''; } catch { return ''; } };

export async function listIncidentProviderConnections(pool,orgId) {
  return withOrg(pool,orgId,async c=>({ok:true,connections:(await c.query(
    'select id,provider,name,active,last_status,last_at,last_error,created_at from incident_provider_connections where org_id=$1 order by provider,name',[orgId]
  )).rows}));
}
export async function createIncidentProviderConnection(pool,orgId,actorId,input={}) {
  const provider=clean(input.provider,30).toLowerCase(), name=clean(input.name,100);
  if(!PROVIDERS.has(provider)) return {ok:false,status:400,error:'Choose PagerDuty, Rootly, or FireHydrant.'};
  if(!name) return {ok:false,status:400,error:'Give this webhook connection a name.'};
  const token='effinc_'+crypto.randomBytes(32).toString('base64url'), tokenHash=digest(token);
  const saved=await withOrg(pool,orgId,async c=>{
    const count=await c.query('select count(*)::int n from incident_provider_connections where org_id=$1 and provider=$2 and active=true',[orgId,provider]);
    if(count.rows[0].n) return null;
    const row=(await c.query('insert into incident_provider_connections(org_id,provider,name,created_by) values($1,$2,$3,$4) returning id',[orgId,provider,name,actorId])).rows[0];
    await c.query('insert into incident_provider_token_registry(token_hash,org_id,connection_id,provider) values($1,$2,$3,$4)',[tokenHash,orgId,row.id,provider]);
    return row;
  });
  if(!saved) return {ok:false,status:409,error:'This workspace already has an active '+provider+' webhook. Revoke it before creating another.'};
  return {ok:true,connection:{id:saved.id,provider,name},secret:token};
}
export async function revokeIncidentProviderConnection(pool,orgId,id) {
  return withOrg(pool,orgId,async c=>{
    const row=(await c.query('update incident_provider_connections set active=false,updated_at=now() where org_id=$1 and id=$2 and active=true returning id,provider',[orgId,Number(id)||0])).rows[0];
    if(!row) return {ok:false,status:404,error:'Active incident webhook not found.'};
    await c.query('update incident_provider_token_registry set active=false where org_id=$1 and connection_id=$2',[orgId,row.id]);
    return {ok:true};
  });
}

function normalize(provider,body,raw) {
  const event=body.event && typeof body.event==='object' ? body.event : body;
  const data=event.data || body.data || event.incident || body.incident || body;
  const incident=data.incident || data.resource || data;
  const attrs=incident.attributes || incident;
  const eventType=clean(first(event.event_type,event.type,typeof body.event==='string'?body.event:undefined,body.event_type,body.type,body.action,attrs.event_type),'120').toLowerCase();
  const statusRaw=clean(first(attrs.status,attrs.state,attrs.current_status,attrs.lifecycle_state,eventType),'80').toLowerCase();
  const severityRaw=clean(first(attrs.severity,attrs.urgency,attrs.priority?.name,attrs.priority,attrs.severity_name),'80').toLowerCase();
  const id=clean(first(incident.id,attrs.id,attrs.incident_id,attrs.uuid,attrs.number),'180');
  if(!id) return null;
  const title=clean(first(attrs.title,attrs.name,attrs.summary,attrs.description,provider+' incident '+id),200);
  const resolved=/resolv|closed|complete|fixed|cancel/.test(statusRaw+' '+eventType);
  const acknowledged=/acknowledg|assign|respond|investigat|mitigat/.test(statusRaw+' '+eventType);
  const ticketStatus=resolved?'solved':acknowledged?'pending':'open';
  const sev1=/critical|sev[- ]?1|p1|high urgency|urgent/.test(severityRaw);
  const sev2=/high|sev[- ]?2|p2/.test(severityRaw);
  const sev4=/low|sev[- ]?4|p4/.test(severityRaw);
  const severity=sev1?'P1':sev2?'P2':sev4?'P4':'P3';
  const priority=sev1?'urgent':sev2?'high':sev4?'low':'normal';
  const impact=sev1?'critical':sev2?'high':sev4?'low':'medium';
  const url=safeExternalUrl(clean(first(attrs.html_url,attrs.url,attrs.web_url,attrs.short_url),'1000'));
  const summary=clean(first(attrs.description,attrs.summary,attrs.details,attrs.description_text),'3000');
  const owner=clean(first(attrs.assignments?.[0]?.assignee?.summary,attrs.assignments?.[0]?.assignee?.name,attrs.assigned_to?.name,attrs.assignee?.name,attrs.responder?.name,attrs.owner?.name),'160');
  const service=clean(first(attrs.service?.summary,attrs.service?.name,attrs.service_name,attrs.services?.[0]?.name),'160');
  const escalation=clean(first(attrs.escalation_policy?.name,attrs.escalation_policy?.summary,attrs.escalation?.name,attrs.escalation_level,attrs.escalation?.level),'160');
  const eventId=clean(first(event!==body?event.id:undefined,body.event_id,body.webhook_id,body.delivery_id,body.id&&String(body.id)!==id?body.id:undefined),200)||digest(raw);
  return {id,title,eventId,eventType,statusRaw,ticketStatus,severity,priority,impact,url,summary,owner,service,escalation};
}

async function applyEvent(pool,orgId,provider,normalized) {
  return withOrg(pool,orgId,async c=>{
    await c.query('select pg_advisory_xact_lock(hashtext($1))',[orgId+':'+provider+':'+normalized.id]);
    const event=await c.query('insert into incident_provider_events(org_id,provider,event_id,external_incident_id) values($1,$2,$3,$4) on conflict do nothing returning event_id',[orgId,provider,normalized.eventId,normalized.id]);
    if(!event.rowCount) return {duplicate:true};
    let link=(await c.query('select l.ticket_id,t.number,t.status,t.priority,t.subject from incident_provider_links l join tickets t on t.org_id=l.org_id and t.id=l.ticket_id where l.org_id=$1 and l.provider=$2 and l.external_incident_id=$3 for update of l,t',[orgId,provider,normalized.id])).rows[0];
    let created=false;
    if(!link) {
      const email=provider+'@integrations.effdesk.com', requester=provider==='pagerduty'?'PagerDuty':provider==='rootly'?'Rootly':'FireHydrant';
      const n=(await c.query('insert into ticket_counters(org_id,last_number) values($1,1) on conflict(org_id) do update set last_number=ticket_counters.last_number+1 returning last_number',[orgId])).rows[0].last_number;
      await ensureContact(c,orgId,{email,name:requester,companyId:null});
      const ticket=(await c.query(`insert into tickets(org_id,number,subject,status,priority,channel,requester_name,requester_email,tags,custom,type,solved_at)
        values($1,$2,$3,$4,$5,'api',$6,$7,$8,'{}'::jsonb,'incident',case when $4 in ('solved','closed') then now() else null end)
        returning id,number,status,priority,subject`,
        [orgId,n,normalized.title,normalized.ticketStatus,normalized.priority,requester,email,['external-incident',provider]])).rows[0];
      await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body) values($1,$2,\'note\',null,$3,$4)',[orgId,ticket.id,requester,normalized.summary||('Incident opened in '+requester+'.')]);
      await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,\'incident\',$4)',[orgId,ticket.id,requester,requester+' incident imported · '+normalized.severity]);
      link=ticket; created=true;
      await c.query('insert into incident_provider_links(org_id,provider,external_incident_id,ticket_id,external_url,external_status,external_severity,external_owner,external_service,external_escalation,last_event_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())',[orgId,provider,normalized.id,ticket.id,normalized.url||null,normalized.statusRaw,normalized.severity,normalized.owner||null,normalized.service||null,normalized.escalation||null]);
    } else {
      const changed=link.status!==normalized.ticketStatus||link.priority!==normalized.priority||link.subject!==normalized.title;
      await c.query(`update tickets set subject=$3,status=$4,priority=$5,solved_at=case when $4 in ('solved','closed') then coalesce(solved_at,now()) else null end,updated_at=now() where org_id=$1 and id=$2`,
        [orgId,link.ticket_id,normalized.title,normalized.ticketStatus,normalized.priority]);
      if(changed) await c.query('insert into ticket_events(org_id,ticket_id,actor_name,kind,detail) values($1,$2,$3,\'incident\',$4)',[orgId,link.ticket_id,provider,provider+' update · '+normalized.statusRaw+' · '+normalized.severity]);
      if(changed && normalized.summary) await c.query('insert into ticket_messages(org_id,ticket_id,kind,author_id,author_name,body) values($1,$2,\'note\',null,$3,$4)',[orgId,link.ticket_id,provider,normalized.summary]);
      await c.query('update incident_provider_links set external_url=coalesce($4,external_url),external_status=$5,external_severity=$6,external_owner=coalesce($7,external_owner),external_service=coalesce($8,external_service),external_escalation=coalesce($9,external_escalation),last_event_at=now(),updated_at=now() where org_id=$1 and provider=$2 and external_incident_id=$3',[orgId,provider,normalized.id,normalized.url||null,normalized.statusRaw,normalized.severity,normalized.owner||null,normalized.service||null,normalized.escalation||null]);
    }
    await c.query(`insert into incident_details(org_id,ticket_id,impact,urgency,severity,is_major)
      values($1,$2,$3,$3,$4,$5)
      on conflict(org_id,ticket_id) do update set impact=excluded.impact,urgency=excluded.urgency,severity=excluded.severity,is_major=excluded.is_major,updated_at=now()`,
      [orgId,link.ticket_id,normalized.impact,normalized.severity,normalized.severity==='P1'||normalized.severity==='P2']);
    return {duplicate:false,created,ticketNumber:link.number,providerIncidentId:normalized.id};
  });
}

export async function receiveIncidentProviderWebhook(req,{pool,provider,token}) {
  if(req.method!=='POST'||!PROVIDERS.has(provider)) return responseError(404,'Unknown incident webhook.');
  if(!token||token.length<30||token.length>150) return responseError(404,'Unknown incident webhook.');
  const raw=await req.text();
  if(raw.length>500000) return responseError(413,'Webhook payload is too large.');
  let body; try{body=JSON.parse(raw);}catch{return responseError(400,'Invalid JSON payload.');}
  const normalized=normalize(provider,body,raw);
  if(!normalized) return responseError(400,'The payload does not contain an incident identifier.');
  const auth=(await pool.query('select org_id,connection_id from incident_provider_token_registry where provider=$1 and token_hash=$2 and active=true',[provider,digest(token)])).rows[0];
  if(!auth) return responseError(401,'Invalid or revoked webhook secret.');
  try {
    const result=await applyEvent(pool,auth.org_id,provider,normalized);
    await withOrg(pool,auth.org_id,c=>c.query('update incident_provider_connections set last_status=$3,last_at=now(),last_error=null,updated_at=now() where org_id=$1 and id=$2',[auth.org_id,auth.connection_id,result.duplicate?'duplicate':'received']));
    return json(200,{ok:true,...result});
  } catch(e) {
    await withOrg(pool,auth.org_id,c=>c.query('update incident_provider_connections set last_status=\'error\',last_at=now(),last_error=$3,updated_at=now() where org_id=$1 and id=$2',[auth.org_id,auth.connection_id,clean(e.message,500)])).catch(()=>{});
    console.error('incident provider webhook:',provider,e.message);
    return responseError(500,'Incident event processing failed.');
  }
}
