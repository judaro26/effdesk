(function(){
'use strict';
var $=function(id){return document.getElementById(id);}, org=$('org'), notice=$('notice'), providers=$('providers'), target=$('target'), provider=$('provider'), credentialProvider=$('credential-provider');
var call=function(method,path,body){return fetch(path,{method:method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{};}).then(function(data){if(!r.ok)throw new Error(data.error||'Request failed ('+r.status+').');return data;});});};
var say=function(s,bad){notice.textContent=s||'';notice.className='msg'+(bad?' err':'');};
var el=function(tag,attrs,text){var x=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){x.setAttribute(k,attrs[k]);});if(text!=null)x.textContent=text;return x;};
var base=function(){return '/api/integrations';}, endpoint=function(path){return base()+path+'?org='+encodeURIComponent(org.value);};
function loadCredentialSettings(){
 if(!org.value)return Promise.resolve();
 var p=credentialProvider.value;
 $('oauth-redirect').textContent=location.origin+'/api/integrations/oauth/callback';
 return call('GET',endpoint('/app-credentials')+'&provider='+encodeURIComponent(p)).then(function(d){
  $('client-id').value='';$('client-secret').value='';
  $('credential-status').textContent=d.customConfigured?'Organization-owned OAuth app is configured for '+p+'.':'Using EffDesk shared OAuth app'+(d.platformConfigured?'.':'; no shared app is configured yet. Add your own credentials to enable connection.');
 }).catch(function(e){$('credential-status').textContent=e.message;});
}
function loadConnections(){
 return call('GET',endpoint('/connections')).then(function(d){
  providers.replaceChildren();
  ['linear','jira'].forEach(function(p){
   var c=d.connections.find(function(x){return x.provider===p;}), name=p==='linear'?'Linear':'Jira';
   var card=el('article',{class:'integration-provider-card integration-provider-'+p});
   var mark=el('div',{class:'integration-provider-mark '+(p==='linear'?'mark-linear':'mark-jira'),'aria-hidden':'true'},p==='linear'?'L':'J');
   var heading=el('div',{class:'integration-provider-title'},el('div',{},el('h2',{},name),el('p',{class:'m'},p==='linear'?'Issues, teams and comments':'Projects, issues and comments')));
   var status=el('span',{class:'integration-status '+(c?'is-connected':'is-disconnected')},c?'Connected':'Not connected');
   card.appendChild(el('div',{class:'integration-provider-top'},mark,heading,status));
   card.appendChild(el('p',{class:'integration-provider-description'},c?'Connected to '+(c.external_workspace_name||'your workspace')+'. Updates can synchronize between EffDesk and '+name+'.':'Connect your '+name+' workspace to create linked issues and synchronize updates.'));
   var actions=el('div',{class:'integration-provider-actions'});
   if(c){var dis=el('button',{type:'button',class:'btn l'},'Disconnect');dis.addEventListener('click',function(){if(!confirm('Disconnect '+name+' from this workspace?'))return;call('POST',endpoint('/disconnect'),{provider:p}).then(loadConnections).catch(function(e){say(e.message,true);});});actions.appendChild(dis);}
   else {var btn=el('button',{type:'button',class:'btn'},'Connect '+name+' →');btn.addEventListener('click',function(){btn.disabled=true;btn.textContent='Connecting…';call('POST',endpoint('/oauth/start'),{provider:p}).then(function(r){location.href=r.url;}).catch(function(e){btn.disabled=false;btn.textContent='Connect '+name+' →';say(e.message,true);});});actions.appendChild(btn);}
   card.appendChild(actions);providers.appendChild(card);
  });
  say('Connections loaded.');
 });
}
function loadCatalog(){
 if(!org.value)return Promise.resolve();
 return call('GET',endpoint('/catalog')+'&provider='+encodeURIComponent(provider.value)).then(function(d){
  target.replaceChildren();(d.items||[]).forEach(function(x){var o=el('option',{value:x.id},x.name);if(x.key)o.dataset.key=x.key;target.appendChild(o);});
  target.dataset.cloudId=d.cloudId||'';target.dataset.siteHost=d.siteHost||'';
  $('target-label').firstChild.textContent=provider.value==='linear'?'Linear team':'Jira project';
 }).catch(function(e){target.replaceChildren();say(e.message,true);});
}
function loadLinks(){
 var n=Number($('ticket').value);if(!n)return Promise.resolve();
 return call('GET',endpoint('/links')+'&ticketNumber='+n).then(function(d){
  var box=$('links');box.replaceChildren();(d.links||[]).forEach(function(x){var p=el('p',{});p.appendChild(document.createTextNode(x.provider.toUpperCase()+' · '));var a=el('a',{href:x.external_issue_url||'#',target:'_blank',rel:'noopener noreferrer'},x.external_issue_key||x.external_issue_id);p.appendChild(a);box.appendChild(p);});
 });
}
$('create').addEventListener('click',function(){
 var n=Number($('ticket').value), p=provider.value, opt=target.options[target.selectedIndex];if(!n||!opt){say('Enter a ticket number and choose a team or project.',true);return;}
 var body={provider:p,ticketNumber:n,teamId:p==='linear'?opt.value:undefined,projectKey:p==='jira'?(opt.dataset.key||opt.value):undefined,cloudId:target.dataset.cloudId,siteHost:target.dataset.siteHost};
 call('POST',endpoint('/link'),body).then(function(d){say('Issue created and linked.');loadLinks();}).catch(function(e){say(e.message,true);});
});
provider.addEventListener('change',loadCatalog);$('ticket').addEventListener('change',loadLinks);org.addEventListener('change',function(){loadConnections();loadCatalog();loadCredentialSettings();});
credentialProvider.addEventListener('change',loadCredentialSettings);
$('save-credentials').addEventListener('click',function(){
 var p=credentialProvider.value, clientId=$('client-id').value.trim(), clientSecret=$('client-secret').value;
 if(!clientId||!clientSecret){$('credential-status').textContent='Enter both Client ID and Client Secret.';return;}
 call('POST',endpoint('/app-credentials'),{provider:p,clientId:clientId,clientSecret:clientSecret}).then(function(){
  $('client-id').value='';$('client-secret').value='';$('credential-status').textContent='Organization OAuth credentials saved securely. You can now connect '+p+'.';
 }).catch(function(e){$('credential-status').textContent=e.message;});
});
$('reset-credentials').addEventListener('click',function(){
 var p=credentialProvider.value;
 call('DELETE',endpoint('/app-credentials'),{provider:p}).then(function(){loadCredentialSettings();}).catch(function(e){$('credential-status').textContent=e.message;});
});
call('GET','/api/me').then(function(d){
 var orgs=d.organizations||[];org.replaceChildren();orgs.forEach(function(o){var x=el('option',{value:o.id},o.name+' ('+o.slug+')');org.appendChild(x);});
 var wanted=new URLSearchParams(location.search).get('org');if(wanted&&orgs.some(function(o){return o.id===wanted;}))org.value=wanted;
 if(!orgs.length){say('No workspace was found for this account.',true);return;}
 return Promise.all([loadConnections(),loadCatalog(),loadCredentialSettings()]);
}).catch(function(e){say(e.message,true);});
})();