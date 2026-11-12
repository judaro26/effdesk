(function(){
'use strict';
var $=function(id){return document.getElementById(id);},org=$('org'),notice=$('notice'),providers=$('providers'),target=$('target'),provider=$('provider'),credentialProvider=$('credential-provider'),connections=[];
var call=function(method,path,body){return fetch(path,{method:method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{};}).then(function(data){if(!r.ok)throw new Error(data.error||'Request failed ('+r.status+').');return data;});});};
var say=function(s,bad){notice.textContent=s||'';notice.className='msg'+(bad?' err':'');notice.hidden=!s;};
var el=function(tag,attrs){var x=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){x.setAttribute(k,attrs[k]);});Array.prototype.slice.call(arguments,2).forEach(function(child){if(child==null||child===false)return;x.appendChild(typeof child==='string'?document.createTextNode(child):child);});return x;};
var base=function(){return '/api/integrations';},endpoint=function(path){return base()+path+'?org='+encodeURIComponent(org.value);};
var names={linear:'Linear',jira:'Jira'};
function applyPortalTheme(d){
 var st=d&&d.settings||{},theme=String(st.theme||'classic'),free=['classic','midnight','mint'];
 if(!d.paid&&free.indexOf(theme)<0)theme='classic';
 document.documentElement.setAttribute('data-theme',theme);
 if(d.paid&&/^#[0-9a-f]{6}$/i.test(st.accent||'')){document.documentElement.style.setProperty('--accent',st.accent);document.documentElement.style.setProperty('--accent-d',st.accent);}
}
function loadPortalTheme(){
 return call('POST','/api/tickets',{orgId:org.value,action:'help-settings-get'}).then(applyPortalTheme).catch(function(){document.documentElement.setAttribute('data-theme','classic');});
}
function icon(p){
 var svg=el('svg',{viewBox:'0 0 48 48','aria-hidden':'true',focusable:'false'});
 if(p==='linear'){
  svg.appendChild(el('path',{d:'M10 9.5 38.5 38a2 2 0 0 1-2.8 2.8L7.2 12.3A2 2 0 0 1 10 9.5Z',fill:'currentColor',opacity:'.28'}));
  svg.appendChild(el('path',{d:'M12 7.5 40.5 36a2 2 0 0 1-2.8 2.8L9.2 10.3A2 2 0 0 1 12 7.5Z',fill:'currentColor'}));
  svg.appendChild(el('path',{d:'M8 17 31 40',stroke:'currentColor','stroke-width':'5','stroke-linecap':'round',opacity:'.65'}));
 }else{
  svg.appendChild(el('path',{d:'M17 5h14l14 14-14 14H17L3 19 17 5Z',fill:'currentColor',opacity:'.45'}));
  svg.appendChild(el('path',{d:'M17 17h14l14 14-14 14H17L3 31l14-14Z',fill:'currentColor'}));
 }
 return svg;
}
function renderProviders(){
 providers.replaceChildren();
 ['linear','jira'].forEach(function(p){
  var c=connections.find(function(x){return x.provider===p;}),name=names[p],card=el('article',{class:'integration-provider-card integration-provider-'+p,'data-provider':p});
  var mark=el('div',{class:'integration-provider-mark mark-'+p},icon(p));
  var title=el('div',{class:'integration-provider-title'},el('h2',{},name),el('p',{class:'m'},p==='linear'?'Issue tracking · Teams · Cycles':'Project tracking · Workflows · Issues'));
  var state=el('span',{class:'integration-status '+(c?'is-connected':'is-disconnected')},c?'Connected':'Not connected');
  card.appendChild(el('div',{class:'integration-provider-top'},mark,title,state));
  card.appendChild(el('p',{class:'integration-provider-description'},c?'Connected to '+(c.external_workspace_name||'your '+name+' workspace')+'. Ticket and issue updates are ready to synchronize.':'Bring your '+name+' work into EffDesk. Create linked issues and keep conversations and ticket updates in sync.'));
  var foot=el('div',{class:'integration-provider-foot'},el('span',{class:'integration-provider-meta'},c?'Workspace connected':'Secure OAuth connection'));
  if(c){
   var dis=el('button',{type:'button',class:'btn l integration-action'},'Disconnect');
   dis.addEventListener('click',function(){if(!confirm('Disconnect '+name+' from this workspace?'))return;dis.disabled=true;call('POST',endpoint('/disconnect'),{provider:p}).then(function(){return loadConnections();}).catch(function(e){dis.disabled=false;say(e.message,true);});});
   foot.appendChild(dis);
  }else{
   var btn=el('button',{type:'button',class:'btn integration-action'},'Connect '+name+' ',el('span',{'aria-hidden':'true'},'→'));
   btn.addEventListener('click',function(){btn.disabled=true;btn.textContent='Connecting…';call('POST',endpoint('/oauth/start'),{provider:p}).then(function(r){location.href=r.url;}).catch(function(e){btn.disabled=false;btn.textContent='Connect '+name+' →';say(e.message,true);});});
   foot.appendChild(btn);
  }
  card.appendChild(foot);providers.appendChild(card);
 });
}
function loadCredentialSettings(){
 if(!org.value)return Promise.resolve();
 var p=credentialProvider.value;
 $('oauth-redirect').textContent='https://app.effdesk.com/api/integrations/oauth/callback';
 return call('GET',endpoint('/app-credentials')+'&provider='+encodeURIComponent(p)).then(function(d){
  $('client-id').value='';$('client-secret').value='';
  $('credential-status').textContent=d.customConfigured?'Your organization’s '+p+' OAuth app is configured.':'EffDesk shared OAuth is the default'+(d.platformConfigured?' and ready to use.':'. No shared app credentials are configured yet; an owner can add organization credentials below.');
 }).catch(function(e){$('credential-status').textContent=e.message;});
}
function loadConnections(){
 return call('GET',endpoint('/connections')).then(function(d){
  connections=d.connections||[];renderProviders();loadCatalog();say('Workspace connections loaded.');
 }).catch(function(e){providers.replaceChildren();say('We couldn’t load workspace connections: '+e.message,true);});
}
function loadCatalog(){
 if(!org.value)return Promise.resolve();
 var p=provider.value,connected=connections.some(function(c){return c.provider===p;});
 target.replaceChildren();target.dataset.cloudId='';target.dataset.siteHost='';
 $('target-label').childNodes[0].textContent=p==='linear'?'Linear team':'Jira project';
 if(!connected){target.appendChild(el('option',{value:''},'Connect '+names[p]+' first'));return Promise.resolve();}
 target.appendChild(el('option',{value:''},'Loading available teams and projects…'));
 return call('GET',endpoint('/catalog')+'&provider='+encodeURIComponent(p)).then(function(d){
  target.replaceChildren();
  if(!(d.items||[]).length){target.appendChild(el('option',{value:''},'No teams or projects found'));return;}
  d.items.forEach(function(x){var o=el('option',{value:x.id},x.name);if(x.key)o.dataset.key=x.key;target.appendChild(o);});
  target.dataset.cloudId=d.cloudId||'';target.dataset.siteHost=d.siteHost||'';
 }).catch(function(e){target.replaceChildren();target.appendChild(el('option',{value:''},'Could not load teams or projects'));say('Couldn’t load the '+names[p]+' catalog: '+e.message,true);});
}
function loadLinks(){
 var n=Number($('ticket').value);if(!n)return Promise.resolve();
 return call('GET',endpoint('/links')+'&ticketNumber='+n).then(function(d){
  var box=$('links');box.replaceChildren();(d.links||[]).forEach(function(x){var p=el('p',{class:'integration-linked-item'},x.provider.toUpperCase()+' · '),a=el('a',{href:x.external_issue_url||'#',target:'_blank',rel:'noopener noreferrer'},x.external_issue_key||x.external_issue_id);p.appendChild(a);box.appendChild(p);});
 }).catch(function(e){say(e.message,true);});
}
$('create').addEventListener('click',function(){
 var n=Number($('ticket').value),p=provider.value,opt=target.options[target.selectedIndex];
 if(!n||!opt||!opt.value){say('Enter a ticket number, connect the selected provider, and choose a team or project.',true);return;}
 var body={provider:p,ticketNumber:n,teamId:p==='linear'?opt.value:undefined,projectKey:p==='jira'?(opt.dataset.key||opt.value):undefined,cloudId:target.dataset.cloudId,siteHost:target.dataset.siteHost};
 var btn=$('create');btn.disabled=true;
 call('POST',endpoint('/link'),body).then(function(){say('Issue created and linked successfully.');return loadLinks();}).catch(function(e){say(e.message,true);}).finally(function(){btn.disabled=false;});
});
provider.addEventListener('change',loadCatalog);$('ticket').addEventListener('change',loadLinks);
org.addEventListener('change',function(){Promise.all([loadConnections(),loadCredentialSettings(),loadPortalTheme()]);});
credentialProvider.addEventListener('change',loadCredentialSettings);
$('save-credentials').addEventListener('click',function(){
 var p=credentialProvider.value,clientId=$('client-id').value.trim(),clientSecret=$('client-secret').value;
 if(!clientId||!clientSecret){$('credential-status').textContent='Enter both Client ID and Client Secret.';return;}
 call('POST',endpoint('/app-credentials'),{provider:p,clientId:clientId,clientSecret:clientSecret}).then(function(){$('client-id').value='';$('client-secret').value='';$('credential-status').textContent='Organization OAuth credentials saved securely. You can now connect '+p+'.';}).catch(function(e){$('credential-status').textContent=e.message;});
});
$('reset-credentials').addEventListener('click',function(){var p=credentialProvider.value;call('DELETE',endpoint('/app-credentials'),{provider:p}).then(loadCredentialSettings).catch(function(e){$('credential-status').textContent=e.message;});});
call('GET','/api/me').then(function(d){
 var orgs=d.organizations||[];org.replaceChildren();orgs.forEach(function(o){org.appendChild(el('option',{value:o.id},o.name+' ('+o.slug+')'));});
 var wanted=new URLSearchParams(location.search).get('org');if(wanted&&orgs.some(function(o){return o.id===wanted;}))org.value=wanted;
 if(!orgs.length){say('No workspace was found for this account.',true);return;}
 return Promise.all([loadConnections(),loadCredentialSettings(),loadPortalTheme()]);
}).catch(function(e){say(e.message,true);});
})();