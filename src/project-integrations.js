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
const scopes = p => p === 'linear' ? 'read,write,issues:create,comments:create' : 'read:jira-work write:jira-work read:jira-user offline_access';
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
  const row=(await pool.query('select access_token_enc,refresh_token_enc,expires_at from project_integrations where org_id=$1 and provider=$2',[org,provider])).rows[0];
  if(!row) throw new Error('Connect '+provider+' first.');
  if(row.expires_at && new Date(row.expires_at).getTime()<Date.now()+60000 && row.refresh_token_enc) {
    const [id,sec]=envKeys(provider,env), refresh=dec(env,row.refresh_token_enc);
    const d=await requestToken(provider==='linear'?'https://api.linear.app/oauth/token':'https://auth.atlassian.com/oauth/token',{grant_type:'refresh_token',refresh_token:refresh,client_id:id,client_secret:sec});
    const exp=new Date(Date.now()+Number(d.expires_in||3600)*1000);
    await pool.query('update project_integrations set access_token_enc=$3,refresh_token_enc=$4,expires_at=$5,updated_at=now() where org_id=$1 and provider=$2',[org,provider,enc(env,d.access_token),d.refresh_token?enc(env,d.refresh_token):row.refresh_token_enc,exp]);
    return d.access_token;
  }
  return dec(env,row.access_token_enc);
}
export async function projectIntegrations(req,{pool,auth,env=process.env}) {
  const url=new URL(req.url), path=url.pathname;
  if(path.endsWith('/oauth/callback')) return oauthCallback(req,{pool,env});
  if(path.includes('/webhook/')) return receiveWebhook(req,{pool,env,provider:path.split('/').pop()});
  if(!originOk(req)) return fail(403,'Cross-origin request refused.');
  const s=await getSession(auth,req); if(!s) return fail(401,'Sign in first.');
  const org=clean(url.searchParams.get('org') || (await req.clone().json().catch(()=>({}))).orgId,100);
  if(!org) return fail(400,'Choose a workspace.');
  const role=await member(pool,org,s.user.id); if(!['owner','admin'].includes(role)) return fail(403,'Only workspace owners and admins can manage external integrations.');
  if(req.method==='GET' && path.endsWith('/connections')) {
    const rows=(await pool.query('select provider,external_workspace_id,external_workspace_name,created_at,updated_at from project_integrations where org_id=$1 order by provider',[org])).rows;
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
    await pool.query('delete from project_integrations where org_id=$1 and provider=$2',[org,p]); return json(200,{ok:true});
  }
  if(path.endsWith('/link') && req.method==='POST') {
    const p=clean(b.provider,20); if(!PROVIDERS.has(p)) return fail(400,'Unknown provider.');
    const t=(await pool.query('select number,subject,description,status,priority from tickets where org_id=$1 and number=$2',[org,Number(b.ticketNumber)||0])).rows[0];
    if(!t) return fail(404,'EffDesk ticket not found.');
    try {
      const token=await tokenFor(pool,env,org,p); let ext;
      if(p==='linear') {
        const teams=await apiCall(p,token,'POST',`query { teams { nodes { id name } } }`);
        const team=teams.teams.nodes.find(x=>x.id===b.teamId)||teams.teams.nodes[0]; if(!team) return fail(400,'No Linear team is available.');
        const d=await apiCall(p,token,'POST',`mutation IssueCreate($input: IssueCreateInput!) { issueCreate(input:$input) { success issue { id identifier url title updatedAt } } }`,{input:{teamId:team.id,title:'[EffDesk #'+t.number+'] '+t.subject,description:'EffDesk ticket #'+t.number+'\\n\\n'+clean(t.description,8000)}});
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
    let workspaceId=null,workspaceName=null,webhookToken=crypto.randomBytes(32).toString('base64url');
    if(row.provider==='jira') {
      const rr=await fetch('https://api.atlassian.com/oauth/token/accessible-resources',{headers:{authorization:'Bearer '+d.access_token,accept:'application/json'}});
      const sites=await rr.json(); const site=sites[0]; if(!site) throw new Error('No Jira Cloud site was authorized.');
      workspaceId=site.id; workspaceName=site.name;
    } else {
      const g=await apiCall('linear',d.access_token,'POST','query { viewer { id name } organization { id name } }');
      workspaceId=g.organization?.id; workspaceName=g.organization?.name;
    }
    await pool.query('insert into project_integrations (org_id,provider,access_token_enc,refresh_token_enc,expires_at,external_workspace_id,external_workspace_name,webhook_url_token_hash) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (org_id,provider) do update set access_token_enc=$3,refresh_token_enc=$4,expires_at=$5,external_workspace_id=$6,external_workspace_name=$7,webhook_url_token_hash=$8,updated_at=now()',[row.org_id,row.provider,enc(env,d.access_token),d.refresh_token?enc(env,d.refresh_token):null,d.expires_in?new Date(Date.now()+Number(d.expires_in)*1000):null,workspaceId,workspaceName,hash(webhookToken)]);
    const base=String(env.APP_URL||'https://app.effdesk.com').replace(/\/$/,'');
    return Response.redirect(base+'/desk.html?org='+encodeURIComponent(row.org_id)+'&integration='+row.provider,303);
  } catch(e) { console.error('project integration OAuth:',e.message); return new Response('Could not complete the external connection. Return to EffDesk and try again.',{status:502}); }
}
async function receiveWebhook(req,{pool,env,provider}) {
  if(!PROVIDERS.has(provider)||req.method!=='POST') return fail(404,'Unknown webhook.');
  const raw=await req.text(); if(raw.length>1000000) return fail(413,'Webhook too large.');
  let body; try{body=JSON.parse(raw);}catch{return fail(400,'Invalid JSON.');}
  let org, row;
  if(provider==='linear') {
    const sig=req.headers.get('linear-signature')||'';
    const candidates=(await pool.query("select org_id,webhook_secret_enc from project_integrations where provider='linear' and webhook_secret_enc is not null")).rows;
    row=candidates.find(x=>{try{const k=dec(env,x.webhook_secret_enc);const want=crypto.createHmac('sha256',k).update(raw).digest('hex');return crypto.timingSafeEqual(Buffer.from(want),Buffer.from(sig));}catch{return false;}});
    if(!row) return fail(401,'Invalid webhook signature.'); org=row.org_id;
  } else {
    const token=clean(new URL(req.url).searchParams.get('key'),200), candidates=(await pool.query("select org_id,webhook_url_token_hash from project_integrations where provider='jira'")).rows;
    row=candidates.find(x=>token && crypto.timingSafeEqual(Buffer.from(hash(token)),Buffer.from(x.webhook_url_token_hash||'')));
    if(!row) return fail(401,'Invalid webhook token.'); org=row.org_id;
  }
  const eventId=clean(body.webhookId||body.id||body.timestamp||crypto.createHash('sha256').update(raw).digest('hex'),200);
  try {
    const handled=await withOrg(pool,org,async c=>{
      const ins=await c.query('insert into project_sync_events (org_id,provider,event_id) values ($1,$2,$3) on conflict do nothing returning event_id',[org,provider,eventId]);
      if(!ins.rowCount) return false;
      const issue=body.data||body.issue||body;
      const issueId=clean(issue.id||issue.issueId,200);
      const link=(await c.query('select ticket_number from project_issue_links where org_id=$1 and provider=$2 and external_issue_id=$3',[org,provider,issueId])).rows[0];
      if(!link) return true;
      return link.ticket_number;
    });
    if(!handled) return json(200,{ok:true,duplicate:true});
    if(typeof handled==='number') {
      const issue=body.data||body.issue||body;
      const state=clean(issue.state?.name||issue.status?.name||issue.state?.type||'',80).toLowerCase();
      const patch={};
      if(/done|complete|closed|resolved/.test(state)) patch.status='solved';
      else if(/progress|started|doing/.test(state)) patch.status='pending';
      else if(/cancel/.test(state)) patch.status='closed';
      if(Object.keys(patch).length) await updateTicket(pool,org,{id:'integration',name:provider+' sync',email:''},handled,patch);
    }
    return json(200,{ok:true});
  } catch(e) { console.error('project webhook sync:',e.message); return fail(500,'Webhook processing failed.'); }
}
