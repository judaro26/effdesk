(function(){
'use strict';
var $=function(id){return document.getElementById(id);}, org=$('org'), notice=$('notice'), providers=$('providers'), target=$('target'), provider=$('provider');
var call=function(method,path,body){return fetch(path,{method:method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return{};}).then(function(data){if(!r.ok)throw new Error(data.error||'Request failed ('+r.status+').');return data;});});};
var say=function(s,bad){notice.textContent=s||'';notice.className='msg'+(bad?' err':'');};
var el=function(tag,attrs,text){var x=document.createElement(tag);Object.keys(attrs||{}).forEach(function(k){x.setAttribute(k,attrs[k]);});if(text!=null)x.textContent=text;return x;};
var base=function(){return '/api/integrations';}, endpoint=function(path){return base()+path+'?org='+encodeURIComponent(org.value);};
function loadConnections(){
 return call('GET',endpoint('/connections')).then(function(d){
  providers.replaceChildren();
  ['linear','jira'].forEach(function(p){
   var c=d.connections.find(function(x){return x.provider===p;}), card=el('article',{class:'tile'});
   card.appendChild(el('h2',{},p==='linear'?'Linear':'Jira'));
   card.appendChild(el('p',{class:'m'},c?'Connected to '+(c.external_workspace_name||'your workspace'):'Not connected'));
   if(c){var dis=el('button',{type:'button'},'Disconnect');dis.addEventListener('click',function(){call('POST',endpoint('/disconnect'),{provider:p}).then(loadConnections).catch(function(e){say(e.message,true);});});card.appendChild(dis);}
   else {var btn=el('button',{type:'button'},'Connect '+(p==='linear'?'Linear':'Jira'));btn.addEventListener('click',function(){call('POST',endpoint('/oauth/start'),{provider:p}).then(function(r){location.href=r.url;}).catch(function(e){say(e.message,true);});});card.appendChild(btn);}
   providers.appendChild(card);
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
provider.addEventListener('change',loadCatalog);$('ticket').addEventListener('change',loadLinks);org.addEventListener('change',function(){loadConnections();loadCatalog();});
call('GET','/api/me').then(function(d){
 var orgs=d.organizations||[];org.replaceChildren();orgs.forEach(function(o){var x=el('option',{value:o.id},o.name+' ('+o.slug+')');org.appendChild(x);});
 var wanted=new URLSearchParams(location.search).get('org');if(wanted&&orgs.some(function(o){return o.id===wanted;}))org.value=wanted;
 if(!orgs.length){say('No workspace was found for this account.',true);return;}
 return Promise.all([loadConnections(),loadCatalog()]);
}).catch(function(e){say(e.message,true);});
})();