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
function loadPortalTheme(workspaceId){
 var id=workspaceId||org.value||new URLSearchParams(location.search).get('org');
 if(!id)return Promise.resolve();
 return call('GET',base()+'/public-theme?org='+encodeURIComponent(id)).then(applyPortalTheme).catch(function(){/* Keep the app's default theme if public workspace styling is unavailable. */});
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
var templateRows=[],templateDefs=[],templateEditingId=0;
var templateMappingOptions=[['','No mapping'],['ticket.subject','Ticket subject'],['ticket.description','Latest ticket message'],['ticket.number','Ticket number'],['ticket.requester_name','Requester name'],['ticket.requester_email','Requester email'],['ticket.priority','Ticket priority']];
function templateCall(method,path,body){var url=base()+path+(path.indexOf('?')>=0?'&':'?')+'org='+encodeURIComponent(org.value);return call(method,url,body);}
function templateProvider(){return $('template-provider').value;}
function templateProject(){return $('template-project').value;}
function templateIssueType(){return $('template-issue-type').value;}
function setTemplateStatus(s,bad){var n=$('template-status');if(n){n.textContent=s||'';n.className='m'+(bad?' err':'');}}
function loadTemplateList(){
 if(!org.value)return Promise.resolve();
 return templateCall('GET','/templates').then(function(d){templateRows=d.templates||[];$('template-form').hidden=!d.canManage;renderTemplateList();}).catch(function(e){$('template-list').textContent=e.message;});
}
function renderTemplateList(){
 var box=$('template-list');if(!box)return;box.replaceChildren();$('template-count').textContent=String(templateRows.length);
 if(!templateRows.length){box.appendChild(el('p',{class:'m'},'No templates yet. Create your first form.'));return;}
 templateRows.forEach(function(t){
  var meta=(t.provider==='linear'?'Linear':'Jira')+' · '+(t.project_name||t.project_id)+(t.issue_type_name?' · '+t.issue_type_name:'');
  var card=el('article',{class:'template-saved-card'},
   el('div',{class:'template-saved-title'},el('strong',{},t.name),el('span',{class:'template-provider-tag tag-'+t.provider},t.provider==='linear'?'Linear':'Jira')),
   el('p',{class:'m'},t.description||meta),
   el('p',{class:'template-saved-meta'},meta),
   el('div',{class:'template-saved-actions'},
    el('button',{type:'button',class:'btn l sm',onclick:function(){editTemplate(t);}},'Edit'),
    el('button',{type:'button',class:'btn l sm',onclick:function(){if(!confirm('Delete the "'+t.name+'" template? Existing linked issues will not be affected.'))return;templateCall('DELETE','/templates',{id:t.id}).then(loadTemplateList).catch(function(e){setTemplateStatus(e.message,true);});}},'Delete')
   ));
  box.appendChild(card);
 });
}
function templateFieldDefinitions(provider,metadata){
 var defs=[{id:'title',name:'Issue title',type:'string',required:true},{id:'description',name:'Description',type:'string',required:false}];
 if(provider==='linear'){
  defs=defs.concat([{id:'priority',name:'Priority',type:'select'},{id:'assigneeId',name:'Assignee',type:'select'},{id:'projectId2',name:'Linear project',type:'select'},{id:'stateId',name:'Initial status',type:'select'},{id:'labelIds',name:'Labels',type:'select'}]);
 }else (metadata&&metadata.fields||[]).forEach(function(x){defs.push({id:x.id,name:x.name||x.id,type:x.type||'string',required:!!x.required,allowedValues:x.allowedValues||[]});});
 return defs;
}
function renderTemplateFields(defs,saved){
 templateDefs=defs;var rootBox=$('template-fields');rootBox.replaceChildren();
 var current={};(saved||[]).forEach(function(x){current[x.id]=x;});
 defs.forEach(function(f){
  var old=current[f.id]||{},include=old.visible!==undefined?old.visible:(f.required||f.id==='title'||f.id==='description');
  var row=el('div',{class:'template-field-row','data-template-field':f.id});
  var use=el('input',{type:'checkbox','aria-label':'Include '+f.name});use.checked=include;use.disabled=!!f.required;
  var required=el('input',{type:'checkbox','aria-label':'Require '+f.name});required.checked=!!f.required||(old.required!==undefined?old.required:false);required.disabled=!!f.required||!include;
  use.addEventListener('change',function(){required.disabled=!use.checked;if(!use.checked)required.checked=false;});
  var def=el('input',{type:'text',class:'template-field-default',maxlength:'1000','aria-label':'Default value for '+f.name,placeholder:'Default value'});def.value=old.defaultValue||'';
  var mapping=el('select',{class:'template-field-mapping','aria-label':'Map '+f.name+' from ticket'},templateMappingOptions.map(function(x){return el('option',{value:x[0]},x[1]);}));mapping.value=old.mapping||'';
  row.appendChild(el('div',{class:'template-field-main'},el('label',{class:'template-field-toggle'},use,el('strong',{},f.name)),el('label',{class:'template-field-required'},required,' Required')));
  row.appendChild(el('div',{class:'template-field-settings'},def,mapping));
  row._templateField={definition:f,include:use,required:required,defaultValue:def,mapping:mapping};
  rootBox.appendChild(row);
 });
 if(!defs.length)rootBox.appendChild(el('p',{class:'m'},'No configurable fields were returned by this provider.'));
}
function templateFieldConfig(){
 return Array.from($('template-fields').querySelectorAll('[data-template-field]')).map(function(row){
  var x=row._templateField,f=x.definition;
  return {id:f.id,name:f.name,type:f.type,visible:x.include.checked,required:x.required.checked,defaultValue:x.defaultValue.value,mapping:x.mapping.value};
 }).filter(function(x){return x.visible;});
}
function loadTemplateFieldDefinitions(saved){
 var p=templateProvider(),project=templateProject(),type=templateIssueType();
 if(!project){renderTemplateFields([{id:'title',name:'Issue title',type:'string',required:true},{id:'description',name:'Description',type:'string'}],saved);return Promise.resolve();}
 var q='/issue-options?provider='+encodeURIComponent(p)+'&project='+encodeURIComponent(project)+(p==='jira'&&type?'&issueType='+encodeURIComponent(type):'');
 return templateCall('GET',q).then(function(meta){
  if(p==='jira'&&!type){
   var types=meta.issueTypes||[],sel=$('template-issue-type-wrap'),s=$('template-issue-type');
   sel.hidden=false;s.replaceChildren(el('option',{value:''},'Choose issue type…'));
   types.forEach(function(x){s.appendChild(el('option',{value:x.id},x.name));});
   if(types.length===1){s.value=types[0].id;return loadTemplateFieldDefinitions(saved);}
   renderTemplateFields([{id:'title',name:'Issue title',type:'string',required:true},{id:'description',name:'Description',type:'string'}],saved);return;
  }
  $('template-issue-type-wrap').hidden=p!=='jira';
  renderTemplateFields(templateFieldDefinitions(p,meta),saved);
 }).catch(function(e){renderTemplateFields([]);setTemplateStatus('Could not load provider fields: '+e.message,true);});
}
function loadTemplateProjects(saved){
 var p=templateProvider(),select=$('template-project'),connected=connections.some(function(x){return x.provider===p;});
 select.replaceChildren();$('template-issue-type-wrap').hidden=true;$('template-issue-type').replaceChildren(el('option',{value:''},'Choose issue type…'));
 if(!connected){select.appendChild(el('option',{value:''},'Connect '+names[p]+' first'));renderTemplateFields([]);return Promise.resolve();}
 select.appendChild(el('option',{value:''},'Loading projects…'));
 return templateCall('GET','/catalog?provider='+encodeURIComponent(p)).then(function(d){
  select.replaceChildren(el('option',{value:''},'Choose a team or project…'));
  (d.items||[]).forEach(function(x){var o=el('option',{value:x.id},x.name+(x.key?' ('+x.key+')':''));o.dataset.name=x.name;select.appendChild(o);});
  select.dataset.cloudId=d.cloudId||'';
  if(saved&&saved.project_id){select.value=saved.project_id;}
  if(select.value)return loadTemplateFieldDefinitions(saved&&saved.form_config?saved.form_config.fields:[]);
  renderTemplateFields([{id:'title',name:'Issue title',type:'string',required:true},{id:'description',name:'Description',type:'string'}],saved&&saved.form_config?saved.form_config.fields:[]);
 }).catch(function(e){select.replaceChildren(el('option',{value:''},'Could not load projects'));setTemplateStatus(e.message,true);});
}
function editTemplate(t){
 templateEditingId=Number(t.id);$('template-id').value=t.id;$('template-provider').value=t.provider;$('template-name').value=t.name;$('template-description').value=t.description||'';
 $('template-save').textContent='Update template';$('template-cancel').hidden=false;setTemplateStatus('Editing '+t.name+'.');
 loadTemplateProjects(t).then(function(){
  if(t.provider==='jira'&&t.issue_type_id){$('template-issue-type-wrap').hidden=false;$('template-issue-type').value=t.issue_type_id;return loadTemplateFieldDefinitions(t.form_config&&t.form_config.fields||[]);}
 }).catch(function(e){setTemplateStatus(e.message,true);});
}
function resetTemplateForm(){
 templateEditingId=0;$('template-form').reset();$('template-id').value='';$('template-save').textContent='Save template';$('template-cancel').hidden=true;$('template-issue-type-wrap').hidden=true;
 loadTemplateProjects();setTemplateStatus('');
}
function loadTemplateBuilder(){
 if(!$('template-form')||!org.value)return Promise.resolve();
 return Promise.all([loadTemplateList(),loadTemplateProjects()]);
}
function saveTemplate(ev){
 ev.preventDefault();var p=templateProvider(),project=$('template-project'),opt=project.options[project.selectedIndex],type=$('template-issue-type'),typeOpt=type.options[type.selectedIndex];
 var body={id:templateEditingId||undefined,provider:p,name:$('template-name').value.trim(),description:$('template-description').value.trim(),projectId:project.value,projectName:opt&&opt.dataset.name||opt&&opt.textContent||'',issueTypeId:p==='jira'?type.value:'',issueTypeName:p==='jira'?typeOpt&&typeOpt.textContent||'':'',formConfig:{fields:templateFieldConfig(),submitLabel:'Create and link issue'}};
 if(!body.projectId){setTemplateStatus('Choose a connected team or project first.',true);return;}
 if(p==='jira'&&!body.issueTypeId){setTemplateStatus('Choose the Jira issue type for this template.',true);return;}
 $('template-save').disabled=true;
 templateCall('POST','/templates',body).then(function(){setTemplateStatus('Template saved. Agents can now use it from a ticket.');resetTemplateForm();return loadTemplateList();}).catch(function(e){setTemplateStatus(e.message,true);}).finally(function(){$('template-save').disabled=false;});
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
  connections=d.connections||[];renderProviders();loadCatalog();loadTemplateBuilder();say('Workspace connections loaded.');
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
$('template-provider').addEventListener('change',function(){templateEditingId=0;loadTemplateProjects();});$('template-project').addEventListener('change',function(){loadTemplateFieldDefinitions();});$('template-issue-type').addEventListener('change',function(){loadTemplateFieldDefinitions();});$('template-form').addEventListener('submit',saveTemplate);$('template-cancel').addEventListener('click',resetTemplateForm);
org.addEventListener('change',function(){Promise.all([loadConnections(),loadCredentialSettings(),loadPortalTheme(org.value),loadTemplateList()]);});
credentialProvider.addEventListener('change',loadCredentialSettings);
$('save-credentials').addEventListener('click',function(){
 var p=credentialProvider.value,clientId=$('client-id').value.trim(),clientSecret=$('client-secret').value;
 if(!clientId||!clientSecret){$('credential-status').textContent='Enter both Client ID and Client Secret.';return;}
 call('POST',endpoint('/app-credentials'),{provider:p,clientId:clientId,clientSecret:clientSecret}).then(function(){$('client-id').value='';$('client-secret').value='';$('credential-status').textContent='Organization OAuth credentials saved securely. You can now connect '+p+'.';}).catch(function(e){$('credential-status').textContent=e.message;});
});
$('reset-credentials').addEventListener('click',function(){var p=credentialProvider.value;call('DELETE',endpoint('/app-credentials'),{provider:p}).then(loadCredentialSettings).catch(function(e){$('credential-status').textContent=e.message;});});
loadPortalTheme(new URLSearchParams(location.search).get('org'));
 call('GET','/api/me').then(function(d){
 var orgs=d.organizations||[];org.replaceChildren();orgs.forEach(function(o){org.appendChild(el('option',{value:o.id},o.name+' ('+o.slug+')'));});
 var wanted=new URLSearchParams(location.search).get('org');if(wanted&&orgs.some(function(o){return o.id===wanted;}))org.value=wanted;
 if(!orgs.length){say('No workspace was found for this account.',true);return;}
 return Promise.all([loadConnections(),loadCredentialSettings(),loadPortalTheme()]);
}).catch(function(e){
  if(/sign in first/i.test(e.message)){
   say('Sign in to manage workspace connections and link tickets.');
   notice.appendChild(document.createTextNode(' '));
   notice.appendChild(el('a',{href:'/auth.html'},'Sign in to EffDesk'));
  }else say(e.message,true);
 });
})();