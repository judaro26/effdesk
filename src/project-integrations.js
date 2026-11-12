// src/project-integrations.js
// Workspace-scoped Linear + Jira OAuth, issue linking, and webhook-driven two-way sync.
import crypto from 'node:crypto';
import { seal, unseal } from './sso.js';
import { withOrg } from './db.js';
import { updateTicket, addMessage } from './tickets.js';

const PROVIDERS = new Set(['linear','jira']);
const clean = (v,n=500) => String(v ?? '').replace(/\u0000/g,'').trim().slice(0,n);
const json = (status, body) => new Response(JSON.stringify(body), {status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const fail = (status,error) => json(status,{error});
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const secret = env => String(env.BETTER_AUTH_SECRET || '');
const callbackUrl = env => String(env.APP_URL || 'https://app.effdesk.com').replace(/\/$/,'') + '/api/integrations/oauth/callback';
const envKeys = (p,env) => p === 'linear' ? [env.LINEAR_CLIENT_ID,env.LINEAR_CLIENT_SECRET] : [env.JIRA_CLIENT_ID,env.JIRA_CLIENT_SECRET];
const scopes = p => p === 'linear' ? 'read,write,issues:create,comments:create' : 'read:jira-work write:jira-work read:jira-user manage:jira-webhook offline_access';
const b64 = v => Buffer.from(v).toString('base64url');
const enc = (env,v) => seal(secret(env),v);
const dec = (env,v) => unseal(secret(env),v);
const originOk = req => { const o=req.headers.get('origin'); return !o || o === new URL(req.url).origin; };
async function member(pool,org,user) { return (await pool.query('select role from member where "organizationId"=$1 and "userId"=$2',[org,user])).rows[0]?.role || ''; }
async function getSession(auth,req) { try { return await auth.api.getSession({headers:req.headers}); } catch { return null; } }
async function requestToken(url,body) {
  const r=await fetch(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams(body),signal:AbortSignal.timeout(12000),redirect:'error'});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error('OAuth token exchange failed ('+r.status+').'); return d;
}
async function apiCall(provider,token,method,pathOrQuery,body) {
  let url,headers={authorization:'Bearer '+token,accept:'application/json'};
  if(provider==='linear') {
    url='https://api.linear.app/graphql'; headers['content-type']='application/json';
    const r=await fetch(url,{method:'POST',headers,body:JSON.stringify({query:pathOrQuery,variables:body||{}}),signal:AbortSignal.timeout(12000)});
    const d=await r.json(); if(!r.ok || d.errors?.length) throw new Error(d.errors?.[0]?.message || 'Linear API request failed.'); return d.data;
  }
  url='https://api.atlassian.com/ex/jira/'+encodeURIComponent(body.cloudId)+pathOrQuery;
  if(method==='GET') { const r=await fetch(url,{headers,signal:AbortSignal.timeout(12000)}); const d=await r.json(); if(!r.ok) throw new Error('Jira API request failed ('+r.status+').'); return d; }
  headers['content-type']='application/json';
  const r=await fetch(url,{method,headers,body:JSON.stringify(body.payload||{}),signal:AbortSignal.timeout(12000)});
  const d=await r.json().catch(()=>({})); if(!r.ok) throw new Error('Jira API request failed ('+r.status+').'); return d;
}
async function tokenFor(pool,env,org,provider) {
  const row=(await withOrg(pool,org,c=>c.query('select access_token_enc,refresh_token_enc,expires_at from project_integrations where org_id=$1 and provider=$2',[org,provider]))).rows[0];
  if(!row) throw new Error('Connect '+provider+' first.');
  if(row.expires_at && new Date(row.expires_at).getTime()<Date.now()+60000 && row.refresh_token_enc) {
    const [id,sec]=envKeys(provider,env), refresh=dec(env,row.refresh_token_enc);
    const d=await requestToken(provider==='linear'?'https://api.linear.app/oauth/token':'https://auth.atlassian.com/oauth/token',{grant_type:'refresh_token',refresh_token:refresh,client_id:id,client_secret:sec});
    const exp=new Date(Date.now()+Number(d.expires_in||3600)*1000);
    await withOrg(pool,org,c=>c.query('update project_integrations set access_token_enc=$3,refresh_token_enc=$4,expires_at=$5,updated_at=now() where org_id=$1 and provider=$2',[org,provider,enc(env,d.access_token),d.refresh_token?enc(env,d.refresh_token):row.refresh_token_enc,exp]));
    return d.access_token;
  }
  return dec(env,row.access_token_enc);
}
export async function projectIntegrations(req,{pool,auth,env=process.env}) {
  const url=new URL(req.url), path=url.pathname;
  if(path.endsWith('/oauth/callback')) return oauthCallback(req,{pool,env});
  if(path.includes('/webhook/')) { const parts=path.split('/').filter(Boolean); return receiveWebhook(req,{pool,env,provider:parts[parts.length-2]}); }
  if(!originOk(req)) return fail(403,'Cross-origin request refused.');
  const s=await getSession(auth,req); if(!s) return fail(401,'Sign in first.');
  const org=clean(url.searchParams.get('org') || (await req.clone().json().catch(()=>({}))).orgId,100);
  if(!org) return fail(400,'Choose a workspace.');
  const role=await member(pool,org,s.user.id); if(!['owner','admin'].includes(role)) return fail(403,'Only workspace owners and admins can manage external integrations.');
  if(req.method==='GET' && path.endsWith('/connections')) {
    const rows=(await withOrg(pool,org,c=>c.query('select provider,external_workspace_id,external_workspace_name,webhook_url_token_enc,created_at,updated_at from project_integrations where org_id=$1 order by provider',[org]))).rows.map(x=>({...x,webhookUrl:x.provider==='jira'?String(env.APP_URL||'https://app.effdesk.com').replace(/\\/$/,'')+'/api/integrations/webhook/jira/'+encodeURIComponent(org)+'?key='+encodeURIComponent(dec(env,x.webhook_url_token_enc)):String(env.APP_URL||'https://app.effdesk.com').replace(/\\/$/,'')+'/api/integrations/webhook/linear/'+encodeURIComponent(org)}));
    const links=(await withOrg(pool,org,c=>c.query('select provider,count(*)::int as links from project_issue_links where org_id=$1 group by provider',[org]))).rows;
    return json(200,{connections:rows,links});
  }
  const b=await req.json().catch(()=>({}));
  if(path.endsWith('/oauth/start') && req.method==='POST') {
    const p=clean(b.provider,20); if(!PROVIDERS.has(p)) return fail(400,'Choose Linear or Jira.');
    const [clientId,clientSecret]=envKeys(p,env); if(!clientId||!clientSecret) return fail(503,'Set '+(p==='linear'?'LINEAR':'JIRA')+'_CLIENT_ID and _CLIENT_SECRET in Netlify environment variables first.');
    const state=crypto.randomBytes(32).toString('base64url');
    await pool.query('delete from project_oauth_states where expires_at < now()');
    await pool.query('insert into project_oauth_states (state_hash,org_id,user_id,provider,expires_at) values ($1,$2,$3,$4,now()+interval \'10 minutes\')',[hash(state),org,s.user.id,p]);
    const authUrl=p==='linear'?'https://linear.app/oauth/authorize':'https://auth.atlassian.com/authorize';
    const u=new URL(authUrl);
    Object.entries({client_id:clientId,redirect_uri:callbackUrl(env),response_type:'code',state,scope:scopes(p),...(p==='jira'?{audience:'api.atlassian.com',prompt:'consent'}:{})}).forEach(([k,v])=>u.searchParams.set(k,v));
    return json(200,{url:u.toString()});
  }
  if(path.endsWith('/disconnect') && req.method==='POST') {
    const p=clean(b.provider,20); if(!PROVIDERS.has(p)) return fail(400,'Unknown provider.');
    await withOrg(pool,org,c=>c.query('delete from project_integrations where org_id=$1 and provider=$2',[org,p])); return json(200,{ok:true});
  }
  if(path.endsWith('/link') && req.method==='POST') {
    const p=clean(b.provider,20); if(!PROVIDERS.has(p)) return fail(400,'Unknown provider.');
    const t=(await withOrg(pool,org,c=>c.query('select number,subject,status,priority from tickets where org_id=$1 and number=$2',[org,Number(b.ticketNumber)||0]))).rows[0];
    if(!t) return fail(404,'EffDesk ticket not found.');
    try {
      const token=await tokenFor(pool,env,org,p); let ext;
      if(p==='linear') {
        const teams=await apiCall(p,token,'POST',`query { teams { nodes { id name } } }`);
        const team=teams.teams.nodes.find(x=>x.id===b.teamId)||teams.teams.nodes[0]; if(!team) return fail(400,'No Linear team is available.');
        const d=await apiCall(p,token,'POST',`mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input:$input) { success issue { id identifier url title updatedAt } } }`,{input:{teamId:team.id,title:'[EffDesk #'+t.number+'] '+t.subject,description:'EffDesk ticket #'+t.number+'\n\n'}});
        ext=d.issueCreate.issue; ext.projectId=team.id;
      } else {
        const cloudId=clean(b.cloudId,120), projectKey=clean(b.projectKey,30); if(!cloudId||!projectKey) return fail(400,'Choose a Jira site and project.');
        const d=await apiCall(p,token,'POST','/rest/api/3/issue',{cloudId,payload:{fields:{project:{key:projectKey},summary:'[EffDesk #'+t.number+'] '+t.subject,description:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'EffDesk ticket #'+t.number}]}]},issuetype:{name:'Task'}}}});
        ext={id:d.id,key:d.key,url:'https://'+clean(b.siteHost,150)+'/browse/'+d.key,projectId:projectKey};
      }
      await withOrg(pool,org,c=>c.query('insert into project_issue_links (org_id,provider,ticket_number,external_issue_id,external_issue_key,external_issue_url,external_project_id) values ($1,$2,$3,$4,$5,$6,$7) on conflict (org_id,provider,ticket_number) do update set external_issue_id=$4,external_issue_key=$5,external_issue_url=$6,external_project_id=$7,updated_at=now()',[org,p,t.number,ext.id,ext.identifier||ext.key||null,ext.url||null,ext.projectId||null]));
      return json(200,{ok:true,issue:ext});
    } catch(e) { return fail(502,e.message); }
  }
  return fail(404,'Unknown integration endpoint.');
}
async function oauthCallback(req,{pool,env}) {
  const u=new URL(req.url),state=clean(u.searchParams.get('state'),200),code=clean(u.searchParams.get('code'),2000);
  if(!state||!code) return new Response('OAuth authorization was cancelled or invalid.',{status:400});
  const row=(await pool.query('delete from project_oauth_states where state_hash=$1 and expires_at>now() returning org_id,user_id,provider',[hash(state)])).rows[0];
  if(!row) return new Response('This connection request expired. Return to EffDesk and try again.',{status:400});
  const [clientId,clientSecret]=envKeys(row.provider,env);
  try {
    const d=await requestToken(row.provider==='linear'?'https://api.linear.app/oauth/token':'https://auth.atlassian.com/oauth/token',{grant_type:'authorization_code',code,redirect_uri:callbackUrl(env),client_id:clientId,client_secret:clientSecret});
    let workspaceId=null,workspaceName=null,webhookToken=crypto.randomBytes(32).toString('base64url'),webhookSecret=crypto.randomBytes(32).toString('base64url');
    if(row.provider==='jira') {
      const rr=await fetch('https://api.atlassian.com/oauth/token/accessible-resources',{headers:{authorization:'Bearer '+d.access_token,accept:'application/json'}});
      const sites=await rr.json(); const site=sites[0]; if(!site) throw new Error('No Jira Cloud site was authorized.');
      workspaceId=site.id; workspaceName=site.name;
    } else {
      const g=await apiCall('linear',d.access_token,'POST','query { viewer { id name } organization { id name } }');
      workspaceId=g.organization?.id; workspaceName=g.organization?.name;
    }
    const base=String(env.APP_URL||'https://app.effdesk.com').replace(/\/+$/, '');
    const hookUrl=row.provider==='linear'?base+'/api/integrations/webhook/linear/'+encodeURIComponent(row.org_id):base+'/api/integrations/webhook/jira/'+encodeURIComponent(row.org_id)+'?key='+encodeURIComponent(webhookToken);
    await withOrg(pool,row.org_id,c=>c.query('insert into project_integrations (org_id,provider,access_token_enc,refresh_token_enc,expires_at,external_workspace_id,external_workspace_name,webhook_secret_enc,webhook_url_token_hash,webhook_url_token_enc) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (org_id,provider) do update set access_token_enc=$3,refresh_token_enc=$4,expires_at=$5,external_workspace_id=$6,external_workspace_name=$7,webhook_secret_enc=$8,webhook_url_token_hash=$9,webhook_url_token_enc=$10,updated_at=now()',[row.org_id,row.provider,enc(env,d.access_token),d.refresh_token?enc(env,d.refresh_token):null,d.expires_in?new Date(Date.now()+Number(d.expires_in)*1000):null,workspaceId,workspaceName,row.provider==='linear'?enc(env,webhookSecret):null,row.provider==='jira'?hash(webhookToken):null,row.provider==='jira'?enc(env,webhookToken):null]));
    if(row.provider==='linear') { try { await apiCall('linear',d.access_token,'POST',`mutation WebhookCreate($input: WebhookCreateInput!) { webhookCreate(input:$input) { success webhook { id } } }`,{input:{url:hookUrl,secret:webhookSecret,resourceTypes:['Issue','Comment']}}); } catch(e) { console.warn('Linear webhook registration:',e.message); } }
    else { try { await apiCall('jira',d.access_token,'POST','/rest/api/3/webhook',{cloudId:workspaceId,payload:{webhooks:[{jqlFilter:'project is not EMPTY',events:['jira:issue_updated','comment_created'],url:hookUrl,excludeBody:false}]}}); } catch(e) { console.warn('Jira webhook registration:',e.message); } }
    return Response.redirect(base+'/desk.html?org='+encodeURIComponent(row.org_id)+'&integration='+row.provider,303);
  } catch(e) { console.error('project integration OAuth:',e.message); return new Response('Could not complete the external connection. Return to EffDesk and try again.',{status:502}); }
}
async function receiveWebhook(req,{pool,env,provider}) {
  if(!PROVIDERS.has(provider)||req.method!=='POST') return fail(404,'Unknown webhook.');
  const raw=await req.text(); if(raw.length>1000000) return fail(413,'Webhook too large.');
  let body; try{body=JSON.parse(raw);}catch{return fail(400,'Invalid JSON.');}
  let org, row;
  const parts=new URL(req.url).pathname.split('/').filter(Boolean), orgId=clean(parts[parts.length-1],100);
  if(!orgId) return fail(400,'Workspace is missing from webhook URL.');
  if(provider==='linear') {
    const sig=req.headers.get('linear-signature')||'';
    const candidates=(await withOrg(pool,orgId,c=>c.query("select org_id,webhook_secret_enc from project_integrations where org_id=$1 and provider='linear' and webhook_secret_enc is not null",[orgId]))).rows;
    row=candidates.find(x=>{try{const k=dec(env,x.webhook_secret_enc);const want=crypto.createHmac('sha256',k).update(raw).digest('hex');return crypto.timingSafeEqual(Buffer.from(want),Buffer.from(sig));}catch{return false;}});
    if(!row) return fail(401,'Invalid webhook signature.'); org=row.org_id;
  } else {
    const token=clean(new URL(req.url).searchParams.get('key'),200), candidates=(await withOrg(pool,orgId,c=>c.query("select org_id,webhook_url_token_hash from project_integrations where org_id=$1 and provider='jira'",[orgId]))).rows;
    row=candidates.find(x=>token && crypto.timingSafeEqual(Buffer.from(hash(token)),Buffer.from(x.webhook_url_token_hash||'')));
    if(!row) return fail(401,'Invalid webhook token.'); org=row.org_id;
  }
  const eventId=clean(body.webhookId||body.id||body.timestamp||crypto.createHash('sha256').update(raw).digest('hex'),200);
  try {
    const handled=await withOrg(pool,org,async c=>{
      const ins=await c.query('insert into project_sync_events (org_id,provider,event_id) values ($1,$2,$3) on conflict do nothing returning event_id',[org,provider,eventId]);
      if(!ins.rowCount) return false;
      const issue=body.data||body.issue||body;
      const issueId=clean(body.type==='Comment'?(issue.issueId||issue.issue?.id): (issue.id||issue.issueId),200);
      const link=(await c.query('select ticket_number from project_issue_links where org_id=$1 and provider=$2 and external_issue_id=$3',[org,provider,issueId])).rows[0];
      if(!link) return true;
      return link.ticket_number;
    });
    if(!handled) return json(200,{ok:true,duplicate:true});
    if(typeof handled==='number') {
      const issue=body.data||body.issue||body;
      const state=clean(issue.state?.name||issue.status?.name||issue.state?.type||issue.fields?.status?.name||'',80).toLowerCase();
      const patch={};
      if(/done|complete|closed|resolved/.test(state)) patch.status='solved';
      else if(/progress|started|doing/.test(state)) patch.status='pending';
      else if(/cancel/.test(state)) patch.status='closed';
      if(Object.keys(patch).length) await updateTicket(pool,org,{id:null,name:provider+' sync',email:''},handled,patch);
      const comment=body.type==='Comment'?issue:body.comment||null;
      const commentText=provider==='linear'?clean(comment?.body,8000):clean(comment?.body?.content?.[0]?.content?.map(x=>x.text||'').join(' ')||comment?.body,8000);
      if(commentText && (body.action==='create'||body.webhookEvent==='comment_created'||body.type==='Comment')) await addMessage(pool,org,{id:null,name:provider+' · '+clean(comment?.user?.name||comment?.author?.displayName,100),email:''},handled,{body:'['+provider.toUpperCase()+'] '+commentText,internal:true});
    }
    return json(200,{ok:true});
  } catch(e) { console.error('project webhook sync:',e.message); return fail(500,'Webhook processing failed.'); }
}


// Push ticket changes and agent replies to the linked external issue. Failures are logged but never block EffDesk ticket work.
export async function syncTicketUpdate(pool,env,org,number,patch={}) {
  try {
    const links=await withOrg(pool,org,c=>c.query('select l.provider,l.external_issue_id,l.external_project_id,i.external_workspace_id from project_issue_links l join project_integrations i on i.org_id=l.org_id and i.provider=l.provider where l.org_id=$1 and l.ticket_number=$2',[org,Number(number)]));
    if(!links.rowCount) return {synced:0};
    const t=(await withOrg(pool,org,c=>c.query('select subject,status,priority from tickets where org_id=$1 and number=$2',[org,Number(number)]))).rows[0]; if(!t) return {synced:0};
    let synced=0;
    for(const link of links.rows) try {
      const token=await tokenFor(pool,env,org,link.provider);
      if(link.provider==='linear') {
        const input={}; if(patch.subject!==undefined) input.title=t.subject;
        if(patch.priority!==undefined) input.priority=({urgent:1,high:2,normal:3,low:4})[t.priority]||3;
        if(patch.status!==undefined) {
          const states=await apiCall('linear',token,'POST',`query TeamStates($id:String!){ team(id:$id){ states{nodes{id name type}} } }`,{id:link.external_project_id});
          const want=t.status==='solved'||t.status==='closed'?'completed':t.status==='pending'?'started':'unstarted';
          const st=states.team.states.nodes.find(x=>x.type===want); if(st) input.stateId=st.id;
        }
        if(Object.keys(input).length) await apiCall('linear',token,'POST',`mutation IssueUpdate($id:String!,$input:IssueUpdateInput!){ issueUpdate(id:$id,input:$input){success} }`,{id:link.external_issue_id,input});
      } else {
        const cloudId=link.external_workspace_id, fields={}; if(patch.subject!==undefined) fields.summary=t.subject;
        if(patch.priority!==undefined) fields.priority={name:({urgent:'Highest',high:'High',normal:'Medium',low:'Low'})[t.priority]};
        if(Object.keys(fields).length) await apiCall('jira',token,'PUT','/rest/api/3/issue/'+encodeURIComponent(link.external_issue_id),{cloudId,payload:{fields}});
        if(patch.status!==undefined) {
          const tr=await apiCall('jira',token,'GET','/rest/api/3/issue/'+encodeURIComponent(link.external_issue_id)+'/transitions',{cloudId});
          const want=t.status==='solved'||t.status==='closed'?/done|complete|resolve|close/i:t.status==='pending'?/progress|doing/i:/to do|open|reopen/i;
          const match=(tr.transitions||[]).find(x=>want.test(x.name)); if(match) await apiCall('jira',token,'POST','/rest/api/3/issue/'+encodeURIComponent(link.external_issue_id)+'/transitions',{cloudId,payload:{transition:{id:match.id}}});
        }
      }
      await withOrg(pool,org,c=>c.query('update project_issue_links set last_synced_at=now(),updated_at=now() where org_id=$1 and provider=$2 and ticket_number=$3',[org,link.provider,Number(number)])); synced++;
    } catch(e) { console.warn('external issue sync failed:',link.provider,e.message); }
    return {synced};
  } catch(e) { console.warn('external issue sync failed:',e.message); return {synced:0}; }
}
export async function syncTicketComment(pool,env,org,number,body) {
  const text=clean(body,8000); if(!text) return {synced:0};
  const links=await withOrg(pool,org,c=>c.query('select l.provider,l.external_issue_id,i.external_workspace_id from project_issue_links l join project_integrations i on i.org_id=l.org_id and i.provider=l.provider where l.org_id=$1 and l.ticket_number=$2',[org,Number(number)]));
  let synced=0;
  for(const link of links.rows) try {
    const token=await tokenFor(pool,env,org,link.provider);
    if(link.provider==='linear') await apiCall('linear',token,'POST',`mutation CommentCreate($input:CommentCreateInput!){ commentCreate(input:$input){success} }`,{input:{issueId:link.external_issue_id,body:'EffDesk agent: '+text}});
    else await apiCall('jira',token,'POST','/rest/api/3/issue/'+encodeURIComponent(link.external_issue_id)+'/comment',{cloudId:link.external_workspace_id,payload:{body:{type:'doc',version:1,content:[{type:'paragraph',content:[{type:'text',text:'EffDesk agent: '+text}]}]}}});
    synced++;
  } catch(e) { console.warn('external comment sync failed:',link.provider,e.message); }
  return {synced};
}
