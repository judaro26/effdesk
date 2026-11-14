// scripts/test-monitoring-alert-webhooks.js
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool, withOrg } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { grantLicense } from '../src/license.js';
import { createMonitoringAlertConnection, listMonitoringAlertConnections, revokeMonitoringAlertConnection, receiveMonitoringAlertWebhook } from '../src/monitoring-alert-webhooks.js';

const SECRET='monitoring-alert-test-secret';
const {url}=await freshDb('monitoring-alert-webhooks');await migrate(url);
const pool=makePool(url),mailer=makeMailer({transport:async()=>{}});
const auth=makeAuth({pool,mailer,secret:SECRET,baseURL:'http://localhost:8888',requireVerified:false});
const signup=async(email,name)=>{
 await auth.api.signUpEmail({body:{email,password:'correct horse battery',name}});
 const r=await auth.api.signInEmail({body:{email,password:'correct horse battery'},returnHeaders:true});
 const cookie=r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(x=>x.split(';')[0]).join('; ');
 return {headers:new Headers({cookie}),user:r.response.user};
};
const owner=await signup('alerts-owner@example.test','Alerts Owner');
const org=await auth.api.createOrganization({body:{name:'Monitoring Workspace',slug:'monitoring-workspace'},headers:owner.headers});
await grantLicense(pool,{orgId:org.id,actorEmail:'owner@effdesk.test',note:'monitoring alert test'});
const query=(sql,args=[])=>withOrg(pool,org.id,c=>c.query(sql,args));
const create=async(provider)=>createMonitoringAlertConnection(pool,org.id,owner.user.id,{provider,name:provider+' production'});
const call=async(provider,secret,payload)=>receiveMonitoringAlertWebhook(new Request('https://app.effdesk.test/api/integrations/alerts/'+provider+'/'+secret,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),{pool,provider,token:secret});
const dd=await create('datadog');
check('Datadog endpoint secret is generated once and connection is listed',dd.ok&&dd.secret.startsWith('effalert_')&&(await listMonitoringAlertConnections(pool,org.id)).connections.length===1);
const ddOpen=await call('datadog',dd.secret,{timestamp:'2026-11-13T10:00:00Z',id:'dd-delivery-1',monitor_id:77,host:'api-01',title:'CPU saturation',text:'CPU > 90%',alert_type:'error',alert_transition:'Triggered',url:'https://app.datadoghq.com/monitors/77'});
const ddBody=await ddOpen.json();
const ddTicket=(await query('select id,number,type,status,priority,subject from tickets where org_id=$1 and number=$2',[org.id,ddBody.alerts[0]?.ticketNumber])).rows[0];
check('Datadog trigger creates a P2 incident ticket',ddOpen.status===200&&ddBody.created===1&&ddTicket?.type==='incident'&&ddTicket.status==='open'&&ddTicket.priority==='high');
const ddRecovered=await call('datadog',dd.secret,{timestamp:'2026-11-13T12:00:00Z',id:'dd-delivery-2',monitor_id:77,host:'api-01',title:'CPU saturation',alert_type:'error',alert_transition:'Recovered'});
check('Datadog recovery resolves the existing alert ticket',(await ddRecovered.json()).alerts[0]?.ticketNumber===ddTicket.number&&(await query('select status from tickets where org_id=$1 and id=$2',[org.id,ddTicket.id])).rows[0].status==='solved');
const ddStale=await call('datadog',dd.secret,{timestamp:'2026-11-13T11:00:00Z',id:'dd-delivery-stale',monitor_id:77,host:'api-01',title:'CPU saturation',alert_type:'error',alert_transition:'Triggered'});
check('An older Datadog event cannot reopen a later-recovered alert',ddStale.status===200&&(await ddStale.json()).alerts[0]?.stale===true&&(await query('select status from tickets where org_id=$1 and id=$2',[org.id,ddTicket.id])).rows[0].status==='solved');
const graf=await create('grafana');
const grafEvent=await call('grafana',graf.secret,{event_id:'graf-delivery-1',status:'firing',alerts:[
 {status:'firing',fingerprint:'graf-fp-1',labels:{alertname:'API latency',severity:'critical',instance:'api-1'},annotations:{description:'p95 latency over 2 seconds'},generatorURL:'https://grafana.example/alerting/1'},
 {status:'firing',fingerprint:'graf-fp-2',labels:{alertname:'Queue backlog',severity:'warning',instance:'worker-1'},annotations:{description:'Queue depth is elevated'}}
]});
const grafBody=await grafEvent.json();
check('Grafana multi-alert deliveries create one ticket per fingerprint',grafEvent.status===200&&grafBody.received===2&&grafBody.created===2&&(await query("select count(*)::int n from monitoring_alert_links where org_id=$1 and provider='grafana'",[org.id])).rows[0].n===2);
check('Grafana severity labels map to P1 and P3', (await query("select count(*)::int n from incident_details d join tickets t on t.id=d.ticket_id where t.org_id=$1 and t.subject in ('API latency','Queue backlog') and d.severity in ('P1','P3')",[org.id])).rows[0].n===2);
const sentry=await create('sentry');
const sentryOpen=await call('sentry',sentry.secret,{action:'created',data:{issue:{id:'sentry-42',title:'TypeError in checkout',level:'error',status:'unresolved',permalink:'https://sentry.example/issues/42'}}});
const sentryTicket=(await query("select id,number,priority,status from tickets where org_id=$1 and subject='TypeError in checkout'",[org.id])).rows[0];
check('Sentry issue events create a deduplicated P2 incident',sentryOpen.status===200&&sentryTicket?.priority==='high'&&sentryTicket.status==='open');
const sentryResolved=await call('sentry',sentry.secret,{action:'resolved',data:{issue:{id:'sentry-42',title:'TypeError in checkout',level:'error',status:'resolved',permalink:'https://sentry.example/issues/42'}}});
check('Sentry resolution updates the same incident ticket',(await sentryResolved.json()).alerts[0]?.ticketNumber===sentryTicket.number&&(await query('select status from tickets where org_id=$1 and id=$2',[org.id,sentryTicket.id])).rows[0].status==='solved');
const splunk=await create('splunk');
const splunkEvent=await call('splunk',splunk.secret,{search_name:'Disk space monitor',result:{host:'db-01',severity:'warning',message:'Disk usage is 92%'},link:'https://splunk.example/app/search'});
check('Splunk saved-search events create readable alert tickets',(await splunkEvent.json()).created===1&&(await query("select priority from tickets where org_id=$1 and subject='Disk space monitor'",[org.id])).rows[0]?.priority==='normal');
const bad=await call('datadog','not-a-valid-secret',{id:'bad',title:'Should not import'});
check('Unknown alert webhook secrets are rejected',bad.status===401);
const revoked=await revokeMonitoringAlertConnection(pool,org.id,dd.connection.id);
check('Revoking a monitoring alert endpoint immediately rejects future deliveries',revoked.ok&&(await call('datadog',dd.secret,{id:'dd-delivery-3',monitor_id:77,host:'api-01',title:'CPU saturation',alert_transition:'Triggered'})).status===401);
await pool.end();await done();
