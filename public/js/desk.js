// public/js/desk.js: the agent desk, laid out like a help-desk console: an icon rail, ticket tabs, an All Tickets tab with filters, queues and saved views, a ticket in three columns (properties, conversation, requester/client/linked/side conversations/timeline), Manage (queues, clients, macros), Email settings, Help center, and the profile menu with themes. Draws text only.
(function (root) {
  'use strict';
  var STATUS = ['active', 'open', 'pending', 'on_hold', 'solved', 'closed'];
  var ICONS = { home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', tickets: 'M4 6h16M4 12h16M4 18h16', mail: 'M3 6h18v12H3z M3 7l9 6 9-6', help: 'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z M12 6v13', manage: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6', reports: 'M4 20V11M10 20V4M16 20v-8M22 20H2', account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6', contacts: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M20 8v6 M23 11h-6', integrations: 'M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1 M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1', approvals: 'M5 12l4 4L19 6 M4 4h16v16H4z', itsm: 'M3 12h5l3 8 4-16 3 8h3', problems: 'M4 5h16M4 12h16M4 19h10 M18 16v6 M15 19h6', changes: 'M4 7h16M4 12h16M4 17h10 M17 15l3 3 3-3', assets: 'M4 7h16v13H4z M8 7V4h8v3 M8 12h8 M8 16h5' };
  // preview colours for the theme cards: [rail, background, panel, accent]; the real look is in desk.css
  var THEMES = [
    { id: 'classic', name: 'Classic', blurb: 'White workspace with a teal rail and blue accents, the familiar help-desk look.', sw: ['#03363d', '#f4f5f7', '#ffffff', '#1f73b7'] },
    { id: 'midnight', name: 'Midnight', blurb: 'Always dark and easy on the eyes.', sw: ['#090c10', '#0f1318', '#171c23', '#f4a030'], },
    { id: 'mint', name: 'Mint', blurb: 'Fresh and light: soft mint, deep green and a clean teal accent.', sw: ['#0b3d36', '#f0f8f5', '#ffffff', '#0f9d7a'] },
    { id: 'aurora', name: 'Aurora', pro: true, blurb: 'Deep indigo with a violet and cyan glow.', sw: ['#3a22a0', '#0c0a1d', '#1a1640', '#8b7bff'] },
    { id: 'sunset', name: 'Sunset', pro: true, blurb: 'Warm cream, coral and plum.', sw: ['#ec4a6c', '#fff4ec', '#fffdfb', '#ec4a6c'] },
    { id: 'forest', name: 'Forest', pro: true, blurb: 'Calm greens with a touch of gold.', sw: ['#245c43', '#eef3ea', '#fbfdf8', '#d4a72c'] },
    { id: 'ocean', name: 'Ocean', pro: true, blurb: 'Crisp blues and clear aqua.', sw: ['#0f4cc0', '#ecf4fb', '#ffffff', '#0aa8cc'] },
    { id: 'orchid', name: 'Orchid', pro: true, blurb: 'Rich plum with pink and violet.', sw: ['#6a1f8c', '#190f20', '#28172f', '#ff6ec7'] },
    { id: 'obsidian', name: 'Obsidian', pro: true, blurb: 'Near-black glass with an electric emerald glow.', sw: ['#0e1a17', '#07090b', '#101416', '#2ee6a6'] },
    { id: 'champagne', name: 'Champagne', pro: true, blurb: 'Warm ivory, espresso and brushed gold. Quietly luxurious.', sw: ['#2b2118', '#faf6ee', '#fffdf9', '#c4902c'] }
  ];
  var PLAN_OF = { article_import: 'Team', sso: 'Pro', live_chat: 'Suite', whatsapp: 'Suite', custom_fields: 'Suite', light_agents: 'Team', bulk_actions: 'Team', queues: 'Team', clients: 'Team', linked_tickets: 'Team', saved_views: 'Team', themes: 'Team', side_conversations: 'Suite', translation: 'Suite', sla: 'Team', reports: 'Team', integrations: 'Team', triggers: 'Team', api: 'Suite' };
  function start(doc, fetchFn, nav) {
    var main = doc.getElementById('main'), rail = doc.getElementById('rail'), tabsEl = doc.getElementById('tabs'), qBox = doc.getElementById('q'), newBtn = doc.getElementById('newbtn'), orgSlot = doc.getElementById('orgsel'), userBtn = doc.getElementById('userbtn'), userMenu = doc.getElementById('usermenu');
    var orgId = '', orgs = [], agents = [], list = [], counts = {}, filter = { status: 'active', assignee: '', q: '', columnFilters: {} }, current = null, note = '', bad = false, creating = false, settings = null, role = '', slug = '', pending = [], articles = null, editing = null, openTabs = [], draft = '', mode = 'reply', me = '', meId = '', meName = '';
    var approvalInbox = false, approvalRows = null, approvalLoading = false, ticketTasks = {}, ticketApprovals = {};
    var incidentsOpen = false, incidentRows = null, incidentLoading = false, incidentDetail = null, incidentServices = [], incidentSelected = 0, incidentSeverity = '', incidentMajorOnly = false, serviceEditorOpen = false;
    var problemsOpen = false, problemRows = null, problemLoading = false, problemDetail = null, problemSelected = 0, problemCreating = false, problemStatus = '';
    var ciOpen=false, ciRows=null, ciLoading=false, ciDetail=null, ciSelected=0, ciEditing=null, ciServices=[], ciVendors=[], ciContracts=[], ciLicenses=[], ciWarranty=[], ciLifecycleOpen=false, ciDiscoveryStatus=null, ciDiscoveryAgents=[], ciDiscoverySoftware=[], ciNewAgentToken='', ciNewAgentCommand='';
    var changesOpen = false, changeRows = null, changeLoading = false, changeDetail = null, changeSelected = 0, changeCreating = false, changeStatus = '', changeRisk = '', changeServices = [], changeApprovalStages = [], cabPolicyOpen = false, cabPolicy = null, cabPolicyLoading = false;
    var saveFile = function (name, text, type) { var u = root.URL.createObjectURL(new root.Blob([text], { type: type })), a = doc.createElement('a'); a.href = u; a.download = name; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { root.URL.revokeObjectURL(u); }, 1000); };
    var externalIssueUi = {}, hlook = null, wst = null, statuses = [], mDetail = false, waCfg = null, waTpls = null, winClosed = false, tplSel = 0, tplVals = [], sending = false, others = [], othersSig = '', conflict = null, kbIndex = -1, helpOpen = false, pendingG = false, qSeq = 0, qItems = [], qSel = -1, routingCfg = null, myAvail = true, formsCfg = null, formEdit = null, mClosed = {}, agentOpen = '', agentInfo = {}, rolesCfg = null, auditCfg = null, exportCfg = null, auditFilter = '', auditWho = '', roleEdit = null, showTimeline = false, exportNotes = false, aiBusy = '', summaries = {}, mig = { provider: 'zendesk', sub: '', email: '', token: '', state: 'idle', log: [], tickets: 0, messages: 0, articles: 0, skipped: 0, note: '' }, hostSlug = '', myNo = '', contactProfile = null, contactRows = null, contactView = 'contacts', contactSearch = '', contactTimer = 0, chatCfg = null, ssoCfg = null, support = false, supportEntered = false, supportAcc = null, fields = [], hoursCfg = null, picked = {}, team = null, tokens = null, newToken = '', rules = null, rd = null, myAvatar = null, hooks = null, newSecret = '', home = true, dash = null, features = [], queues = [], clients = [], macros = [], views = [], ticketColumns = ['status', 'number', 'subject', 'requester', 'priority', 'assignee', 'updated'], columnsOpen = false, ticketPrefsSig = '', ticketPrefsTimer = 0, columnFilterTimer = 0, labels = [], isAdmin = false, theme = 'classic', manage = '', profile = false, report = null, reportDays = 30, translated = {}, notify = true, sla = null, editMsg = null, mergeArmed = false, macroPatch = null, sendStatus = '', savingView = false, menuOpen = false, mEdit = null, contactProfile = null, contactRows = null, contactView = 'contacts', contactSearch = '';
    var locale = 'en';
    var tr = function (s) { return root.EffI18n ? root.EffI18n.t(s, locale) : s; };
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { var v = props[k]; if (k === 'class') e.className = v; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, ['aria-label','aria-description','title','placeholder'].indexOf(k) >= 0 && typeof v === 'string' ? tr(v) : v); }); [].concat.apply([], [].slice.call(arguments, 2)).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(tr(c)) : c); }); return e; };
    var icon = function (name) { var ns = 'http://www.w3.org/2000/svg', s = doc.createElementNS(ns, 'svg'), p = doc.createElementNS(ns, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', ICONS[name]); s.appendChild(p); return s; };
    var post = function (path, body) { return fetchFn(path, { method: path === '/api/me' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: path === '/api/me' ? undefined : JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var api = function (action, extra) { return post('/api/tickets', Object.assign({ orgId: orgId, action: action }, extra || {})); };
    var noteTimer = 0, say = function (t, isBad) { note = t; bad = !!isBad; draw(); root.clearTimeout(noteTimer); if (t) noteTimer = root.setTimeout(function () { if (note !== t) return; note = ''; var e = doc.querySelector('.deskapp .msg.toast'); if (e) e.remove(); }, isBad ? 8000 : 3500); };
    var size = function (n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
    var when = function (s) { try { return new Date(s).toLocaleString(); } catch (e) { return String(s); } };
    var ago = function (s) { var m = Math.round((Date.now() - new Date(s).getTime()) / 60000); if (!isFinite(m)) return ''; if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago'; return Math.round(m / 1440) + ' d ago'; };
    var cap = function (s) { return s ? s.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : ''; };
    var avatarEl = function (cls, name, url) { var s = el('span', { class: 'av ' + cls, 'aria-hidden': 'true' }); if (url && /^data:image\//.test(url)) s.appendChild(el('img', { src: url, alt: '' })); else s.textContent = initial(name); return s; };
    var avatarOf = function (id) { var a = agents.filter(function (x) { return x.id === id; })[0]; return a && a.avatar || null; };
    var paintMe = function () { var a = doc.getElementById('av'); if (!a) return; while (a.firstChild) a.removeChild(a.firstChild); if (myAvatar && /^data:image\//.test(myAvatar)) a.appendChild(el('img', { src: myAvatar, alt: '' })); else a.textContent = initial(me); };
    var initial = function (s) { return (String(s || '?').trim()[0] || '?').toUpperCase(); };
    var has = function (f) { return features.indexOf(f) >= 0; };
    var dur = function (ms) { var m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + ' min' : m < 2880 ? (Math.round(m / 6) / 10) + ' h' : Math.round(m / 1440) + ' d'; };
    var minsText = function (m) { return m === null || m === undefined ? '—' : dur(m * 60000); };
    var slaText = function (t) { if (!t) return ''; if (t.state === 'met') return 'met'; if (t.state === 'missed') return 'missed'; var d = t.due - Date.now(); return d < 0 ? 'breached ' + dur(-d) + ' ago' : 'due in ' + dur(d); };
    var slaChips = function (s) { return s ? [s.first ? el('span', { class: 'sla s-' + s.first.state, 'data-sla': 'first' }, 'First reply ' + slaText(s.first)) : null, s.resolve ? el('span', { class: 'sla s-' + s.resolve.state, 'data-sla': 'resolve' }, 'Solve ' + slaText(s.resolve)) : null] : []; };
    var lock = function (f) { return el('span', { class: 'lock', 'data-lock': f }, 'Part of the ' + PLAN_OF[f] + ' plan. ', el('a', { href: '/app.html' }, 'Upgrade')); };
    var closePanes = function () { ciOpen=false; ciSelected=0; ciDetail=null; ciEditing=null; changesOpen = false; changeSelected = 0; changeDetail = null; changeCreating = false; changeApprovalStages = []; problemsOpen = false; problemSelected = 0; problemDetail = null; problemCreating = false; incidentsOpen = false; incidentSelected = 0; incidentDetail = null; serviceEditorOpen = false; approvalInbox = false; winClosed = false; mDetail = false; picked = {}; home = false; current = null; creating = false; settings = null; articles = null; editing = null; manage = ''; profile = false; report = null; mergeArmed = false; editMsg = null; };
    var noteFrom = function (r) { return say(r.body.error || 'That did not work.', true); };

    function applyTheme(id) { theme = id; doc.documentElement.setAttribute('data-theme', id); try { root.localStorage.setItem('eff_theme', id); } catch (e) { /* storage may be blocked */ } }
    function support0(n) { return !!new URLSearchParams(n.search || '').get('support'); }
    function boot() {
      return post('/api/me').then(function (r) {
        if (r.status === 401) return nav.go('/auth.html?mode=signin');
        orgs = r.body.organizations; me = r.body.user.email; meId = r.body.user.id; meName = r.body.user.name || me; doc.getElementById('who').textContent = me; doc.getElementById('av').textContent = initial(me);
        var base = r.body.deskBase || '', host = String(nav.host || '').toLowerCase(); hostSlug = base && host.length > base.length + 1 && host.slice(-(base.length + 1)) === '.' + base && host !== 'app.' + base ? host.slice(0, -(base.length + 1)) : '';
        var pm = /^(?:\/w\/([a-z0-9-]+))?(?:\/agent\/\d+)?(?:\/tickets\/(\d+))?/.exec(nav.path || ''), want = new URLSearchParams(nav.search || '').get('org'); var o = (hostSlug && orgs.filter(function (x) { return x.slug === hostSlug; })[0]) || (!hostSlug && pm && pm[1] && orgs.filter(function (x) { return x.slug === pm[1]; })[0]) || orgs.filter(function (x) { return x.id === want; })[0] || (new URLSearchParams(nav.search || '').get('support') && want ? { id: want, role: 'admin', slug: '' } : orgs[0]);
        if (!o) { main.textContent = ''; main.appendChild(el('p', { class: 'pad' }, 'Create an organization first on the ', el('a', { href: '/app.html' }, 'account page'), '.')); return; }
        if (hostSlug && o.slug !== hostSlug) { main.textContent = ''; main.appendChild(el('p', { class: 'pad' }, 'You are not a member of the workspace ' + hostSlug + '. Ask an owner to invite you, or ', el('a', { href: 'https://app.' + base + '/app.html' }, 'open your own workspaces'), '.')); return; }
        if (base && !hostSlug && o.slug && !support0(nav) && nav.go) { var np = r.body.user.agentNumber, changeLink = new URLSearchParams(nav.search || '').get('change'); return nav.go('https://' + o.slug + '.' + base + '/agent/' + (np || 0) + '/tickets' + (pm && pm[2] ? '/' + pm[2] : '') + (changeLink ? '?change=' + encodeURIComponent(changeLink) : '')); }
        announce(r.body.banner);
        if (o.suspended && !support0(nav)) { main.textContent = ''; main.appendChild(el('div', { class: 'pad', 'data-suspended': '1', role: 'alert' }, el('h2', {}, 'This workspace is suspended'), el('p', {}, typeof o.suspended === 'string' ? o.suspended : 'Access has been paused.'), el('p', { class: 'm' }, 'Write to support@effdesk.com to get it back.'))); return; }
        orgId = o.id; role = o.role; slug = o.slug; var params = new URLSearchParams(nav.search || ''), tn = Number(params.get('ticket')) || (pm && Number(pm[2])) || 0, changeNo = Number(params.get('change')) || 0; myNo = r.body.user.agentNumber || ''; return loadInit().then(refresh).then(function () { if (changeNo > 0) return loadChanges().then(function () { return openChange(changeNo); }); if (tn > 0) return open(tn); return goHome(); });
      });
    }
    // the platform owner's announcement, shown above everything and never rewritten by a page
    function announce(bn) {
      var old = doc.getElementById('announcement'); if (old) old.remove(); if (!bn || !bn.text) return;
      var bar = el('div', { id: 'announcement', class: 'announce ' + (bn.tone === 'warn' || bn.tone === 'danger' ? bn.tone : 'info'), role: 'status', 'data-announcement': '1' }, bn.text);
      if (bn.link) bar.appendChild(el('span', {}, ' ', el('a', { href: bn.link, target: '_blank', rel: 'noopener' }, 'Details')));
      doc.body.insertBefore(bar, doc.body.firstChild);
    }
    function supportBar() {
      if (!doc.getElementById('supportbar')) { var bar = el('div', { id: 'supportbar', class: 'supportbar', role: 'status', 'data-support-bar': '1' }, 'Support view: you are looking at this workspace with the customer’s permission. It is read-only and every visit is logged for them. ', el('a', { href: '/admin.html#customers' }, 'Back to the admin page')); doc.body.insertBefore(bar, doc.body.firstChild); }
      if (!supportEntered) { supportEntered = true; api('support-enter'); }
    }
    function loadInit() { api('availability-get').then(function (r) { if (r.ok) myAvail = r.body.available !== false; }); return api('init').then(function (r) { if (!r.ok) return; var b = r.body; agents = b.agents || []; myAvatar = b.avatar || null; paintMe(); features = b.features || []; queues = b.queues || []; statuses = b.statuses || []; clients = b.clients || []; macros = b.macros || []; fields = b.fields || []; support = !!b.support; if (support) supportBar(); views = b.views || []; if (b.ticketPrefs) { filter = Object.assign({ status: 'active', assignee: '', q: '', columnFilters: {} }, b.ticketPrefs.filters || {}); ticketColumns = Array.isArray(b.ticketPrefs.columns) && b.ticketPrefs.columns.length ? b.ticketPrefs.columns.slice() : ticketColumns; qBox.value = filter.q || ''; if (b.ticketPrefs.locale === 'es' || b.ticketPrefs.locale === 'en') locale = b.ticketPrefs.locale; else if (root.EffI18n) locale = root.EffI18n.getLocale(); if (root.EffI18n) root.EffI18n.setLocale(locale, { persist: false }); ticketPrefsSig = JSON.stringify({ filters: filter, columns: ticketColumns, locale: locale }); } labels = b.labels || []; isAdmin = !!b.admin; notify = b.notify !== false; sla = b.sla || null; if (b.theme) applyTheme(b.theme); }); }
    function persistTicketPrefs() {
      var snapshot = { filters: filter, columns: ticketColumns, locale: locale }, signature = JSON.stringify(snapshot);
      if (signature === ticketPrefsSig) return;
      root.clearTimeout(ticketPrefsTimer);
      ticketPrefsTimer = root.setTimeout(function () {
        api('ticket-prefs-save', snapshot).then(function (r) {
          if (r.ok) ticketPrefsSig = signature;
          else if (r.status !== 401) console.warn('Could not save ticket filters:', r.body.error || r.status);
        });
      }, 350);
    }
    function refresh() { persistTicketPrefs(); kbIndex = -1; return api('list', filter).then(function (r) { if (r.ok) { list = r.body.tickets; counts = r.body.counts; } else say(r.body.error || 'That did not work.', true); draw(); }); }
    // the address bar shows where you are, like /w/acme/agent/10042/tickets/57
    function addr(n) { try { if (nav.replace && slug && myNo) nav.replace((hostSlug ? '' : '/w/' + slug) + '/agent/' + myNo + '/tickets' + (n ? '/' + n : '')); } catch (e) { /* address only */ } }
    function open(n) {
      return api('get', { number: n }).then(function (r) {
        if (!r.ok) return say(r.body.error, true); addr(n);
        if (!current || current.ticket.number !== n) { draft = ''; mode = 'reply'; pending = []; macroPatch = null; sendStatus = ''; conflict = null; others = []; othersSig = ''; }
        closePanes(); current = r.body; if (externalIssueUi[n]) { externalIssueUi[n].loaded = false; externalIssueUi[n].error = ''; }
        var hit = openTabs.filter(function (x) { return x.number === n; })[0]; if (hit) hit.subject = r.body.ticket.subject; else openTabs.push({ number: n, subject: r.body.ticket.subject });
        draw(); presenceTick();
      });
    }
    function loadContacts() {
      if(!has('clients'))return Promise.resolve();
      return api('contact-list',{q:contactSearch}).then(function(r){if(!r.ok)return say(r.body.error||'Could not load contacts.',true);contactRows=r.body.contacts||[];if((manage==='contacts'&&!contactProfile)||manage==='clients')draw();});
    }
    function openContact(email) {
      contactProfile=null;contactRows=null;contactSearch='';contactView='contacts';home=false;current=null;creating=false;settings=null;articles=null;report=null;profile=false;manage='contacts';mDetail=true;draw();
      api('contact-get',{email:email}).then(function(r){if(!r.ok)return say(r.body.error||'Could not open contact.',true);contactProfile=r.body;draw();});
    }
    function goViews() { closePanes(); draw(); }
    function loadApprovals() {
      closePanes(); approvalInbox = true; approvalRows = null; approvalLoading = true; draw();
      return api('approvals-list', { status: 'pending' }).then(function (r) {
        approvalLoading = false;
        if (!r.ok) { approvalRows = []; say(r.body.error || 'Could not load approvals.', true); }
        else approvalRows = r.body.approvals || [];
        draw();
      });
    }
    function approvalsPane() {
      var rows = approvalRows || [];
      var content = approvalLoading ? el('p', { class: 'm' }, 'Loading approvals…') : !rows.length ? el('div', { class: 'pcard approval-empty' }, el('div', { class: 'approval-empty-icon' }, '✓'), el('h3', {}, 'You’re all caught up'), el('p', { class: 'm' }, 'Requests waiting for your approval will appear here.')) : rows.map(function (a) {
        var decisions = a.decisions || [], stageIndex = Number(a.current_stage) || 0, activeStage = (a.stages || [])[stageIndex], stageDecisions = decisions.filter(function (d) { return Number(d.stageIndex || 0) === stageIndex; }), responded = stageDecisions.some(function (d) { return d.approverId === meId; });
        var comment = el('textarea', { rows: '2', maxlength: '2000', 'aria-label': 'Approval comment for ticket ' + a.ticket_number, placeholder: 'Add a comment (optional)…' });
        var rule = (activeStage && activeStage.name ? activeStage.name + ' · ' : '') + (a.mode === 'any' ? 'Any one approver' : 'All approvers') + ((a.stages || []).length > 1 ? ' · Stage ' + (stageIndex + 1) + ' of ' + a.stages.length : '');
        return el('article', { class: 'approval-card', 'data-approval': String(a.id) },
          el('div', { class: 'approval-card-top' }, el('div', { class: 'approval-card-title' }, el('span', { class: 'approval-kicker' }, 'TICKET #' + a.ticket_number), el('h3', {}, a.title || 'Request approval'), el('p', { class: 'm' }, a.subject || 'Service request'), el('p', { class: 'm' }, (a.requester_name || a.requester_email || 'Requester') + ' · ' + ago(a.created_at))), el('span', { class: 'approval-rule' }, rule)),
          el('div', { class: 'approval-progress' }, el('span', {}, stageDecisions.filter(function (d) { return d.decision === 'approved'; }).length + ' approved in this stage'), el('span', {}, ' · ' + stageDecisions.length + ' of ' + (a.approver_ids || []).length + ' responses')),
          decisions.length ? el('div', { class: 'approval-decisions' }, decisions.map(function (d) { var ag = agents.filter(function (x) { return x.id === d.approverId; })[0]; return el('span', { class: 'approval-decision ' + d.decision }, (ag ? ag.name || ag.email : 'Approver') + ' · ' + cap(d.decision)); })) : null,
          responded ? el('p', { class: 'm' }, 'You have already responded to this request.') : el('div', { class: 'approval-actions' }, comment, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', onclick: function () { api('approval-decide', { id: a.id, decision: 'approved', comment: comment.value }).then(function (r) { if (!r.ok) return say(r.body.error || 'Could not approve this request.', true); say(r.body.status === 'approved' ? 'Request approved.' : 'Approval recorded.'); loadApprovals(); }); } }, 'Approve'), el('button', { type: 'button', class: 'btn danger', onclick: function () { if (!comment.value.trim() && !root.confirm('Reject this request without a comment?')) return; api('approval-decide', { id: a.id, decision: 'rejected', comment: comment.value }).then(function (r) { if (!r.ok) return say(r.body.error || 'Could not reject this request.', true); say('Request rejected.'); loadApprovals(); }); } }, 'Reject'))),
          el('button', { type: 'button', class: 'btn l sm', onclick: function () { open(a.ticket_number); } }, 'Open ticket →'));
      });
      return el('div', { class: 'page wide approvals-page' }, el('div', { class: 'bar approval-heading' }, el('div', {}, el('h2', {}, 'Approvals'), el('p', { class: 'm' }, 'Review service requests assigned to you and keep decisions moving.')), el('span', { class: 'grow' }), el('button', { type: 'button', class: 'btn l', onclick: loadApprovals }, 'Refresh')), el('div', { class: 'approval-list' }, content));
    }

    // ── ITSM incident workspace (incidents remain ordinary tickets) ──
    function loadItsm() {
      closePanes(); incidentsOpen = true; incidentRows = null; incidentServices = []; incidentLoading = true; incidentSelected = 0; incidentDetail = null; draw();
      return Promise.all([api('itsm-incident-list', { limit: 200 }), api('itsm-services-list')]).then(function (rs) {
        incidentLoading = false;
        if (!rs[0].ok || !rs[1].ok) { incidentRows = []; incidentServices = []; say((!rs[0].ok ? rs[0].body.error : rs[1].body.error) || 'Could not load ITSM.', true); }
        else { incidentRows = rs[0].body.incidents || []; incidentServices = rs[1].body.services || []; }
        draw();
      });
    }
    function openIncidentDetail(number) {
      incidentSelected = Number(number) || 0; incidentDetail = null; draw();
      return api('itsm-incident-get', { number: incidentSelected }).then(function (r) {
        if (!r.ok) { incidentSelected = 0; return say(r.body.error || 'Could not load incident.', true); }
        incidentDetail = r.body; draw();
      });
    }
    function itsmPane() {
      var rows = incidentRows || [], selected = incidentDetail && incidentDetail.incident;
      var severityOptions = [['','All severities'],['P1','P1 · Critical'],['P2','P2 · High'],['P3','P3 · Moderate'],['P4','P4 · Low']];
      var filterSeverity = el('select', { 'aria-label': 'Filter by severity' });
      severityOptions.forEach(function (o) { var op=el('option',{value:o[0]},o[1]); op.selected=o[0]===incidentSeverity; filterSeverity.appendChild(op); });
      filterSeverity.addEventListener('change',function(){incidentSeverity=filterSeverity.value;incidentRows=null;incidentLoading=true;draw();api('itsm-incident-list',{limit:200,severity:incidentSeverity,majorOnly:incidentMajorOnly}).then(function(r){incidentLoading=false;incidentRows=r.ok?(r.body.incidents||[]):[];if(!r.ok)say(r.body.error,true);draw();});});
      var refreshButton=el('button',{type:'button',class:'btn l',onclick:loadItsm},'Refresh');
      var majorToggle=el('button',{type:'button',class:'btn '+(incidentMajorOnly?'':'l'),'aria-pressed':String(incidentMajorOnly),onclick:function(){incidentMajorOnly=!incidentMajorOnly;incidentRows=null;incidentLoading=true;draw();api('itsm-incident-list',{limit:200,severity:incidentSeverity,majorOnly:incidentMajorOnly}).then(function(r){incidentLoading=false;incidentRows=r.ok?(r.body.incidents||[]):[];if(!r.ok)say(r.body.error,true);draw();});}},incidentMajorOnly?'Major incidents only ✓':'Major incidents');
      var p1=rows.filter(function(x){return x.severity==='P1';}).length, major=rows.filter(function(x){return x.is_major;}).length, active=rows.filter(function(x){return ['open','pending','on_hold'].indexOf(x.status)>=0;}).length;
      var stats=el('div',{class:'stats itsm-stats'},
        el('div',{class:'stat'},el('div',{class:'sv'},String(rows.length)),el('div',{class:'sl'},'Incidents')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(active)),el('div',{class:'sl'},'Active')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(p1)),el('div',{class:'sl'},'P1 critical')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(major)),el('div',{class:'sl'},'Major incidents')));
      var table=el('div',{class:'itsm-table-wrap'});
      if(incidentLoading)table.appendChild(el('p',{class:'m'},'Loading incidents…'));
      else if(!rows.length)table.appendChild(el('div',{class:'pcard approval-empty'},el('h3',{},'No incidents found'),el('p',{class:'m'},'Create a ticket and set its type to Incident. It will appear here automatically.')));
      else {
        var tbl=el('table',{class:'itsm-table'});
        tbl.appendChild(el('thead',{},el('tr',{},['Severity','Incident','Status','Impact','Services','Updated'].map(function(h){return el('th',{},h);}))));
        var body=el('tbody');
        rows.forEach(function(x){
          var tr=el('tr',{class:incidentSelected===Number(x.number)?'selected':'','data-incident':String(x.number),tabindex:'0',role:'button','aria-label':'Open incident #'+x.number+' '+x.subject});
          tr.appendChild(el('td',{},el('span',{class:'itsm-severity '+String(x.severity||'P3').toLowerCase()},x.severity||'P3'),x.is_major?el('span',{class:'itsm-major-tag'},'MAJOR'):null));
          tr.appendChild(el('td',{},el('strong',{},'#'+x.number+' '+x.subject),el('span',{class:'itsm-subline'},x.requester_name||x.requester_email||'Unknown requester')));
          tr.appendChild(el('td',{},el('span',{class:'badge s-'+x.status},cap(x.status))));
          tr.appendChild(el('td',{},cap(x.impact||'medium')));
          tr.appendChild(el('td',{},String(x.affected_services||0)));
          tr.appendChild(el('td',{},ago(x.updated_at)));
          var choose=function(){openIncidentDetail(x.number);};tr.addEventListener('click',choose);tr.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});
          body.appendChild(tr);
        });
        tbl.appendChild(body);table.appendChild(tbl);
      }
      var listCard=el('section',{class:'pcard itsm-list-card'},
        el('div',{class:'itsm-card-head'},el('div',{},el('h3',{},'Incident queue'),el('p',{class:'m'},'Prioritized by severity and recent activity.')),el('div',{class:'itsm-toolbar'},filterSeverity,majorToggle,refreshButton)),table);
      var servicesCard=el('section',{class:'pcard itsm-services-card'},el('div',{class:'itsm-card-head'},el('div',{},el('h3',{},'Business services'),el('p',{class:'m'},'Services that can be associated with affected incidents.')),isAdmin?el('button',{type:'button',class:'btn l sm',onclick:function(){serviceEditorOpen=!serviceEditorOpen;draw();}},serviceEditorOpen?'Cancel':'＋ Add service'):null));
      if(serviceEditorOpen&&isAdmin){
        var sn=el('input',{type:'text',maxlength:'120',placeholder:'Service name','aria-label':'Service name'});
        var sd=el('textarea',{rows:'2',maxlength:'2000',placeholder:'What does this service do?','aria-label':'Service description'});
        var sc=el('select',{'aria-label':'Service criticality'},[['low','Low criticality'],['medium','Medium criticality'],['high','High criticality'],['critical','Critical']].map(function(x){return el('option',{value:x[0]},x[1]);}));
        var ss=el('select',{'aria-label':'Service status'},[['operational','Operational'],['degraded','Degraded'],['outage','Outage'],['maintenance','Maintenance'],['retired','Retired']].map(function(x){return el('option',{value:x[0]},x[1]);}));
        servicesCard.appendChild(el('div',{class:'itsm-service-form'},sn,sd,sc,ss,el('button',{type:'button',class:'btn',onclick:function(){if(!sn.value.trim())return say('Give the service a name.',true);api('itsm-service-save',{name:sn.value,description:sd.value,criticality:sc.value,status:ss.value}).then(function(r){if(!r.ok)return say(r.body.error||'Could not save service.',true);serviceEditorOpen=false;loadItsm();say('Business service created.');});}},'Save service')));
      }
      if(!incidentServices.length)servicesCard.appendChild(el('p',{class:'m'},'No business services have been configured yet.'));
      else {
        var serviceGrid=el('div',{class:'itsm-service-grid'});
        incidentServices.forEach(function(s){serviceGrid.appendChild(el('div',{class:'itsm-service-item'},el('span',{class:'itsm-service-dot '+s.status},''),el('div',{class:'grow'},el('strong',{},s.name),el('span',{class:'itsm-subline'},cap(s.criticality)+' criticality · '+cap(s.status))),el('span',{class:'itsm-service-owner'},s.owner_name||'')));});
        servicesCard.appendChild(serviceGrid);
      }
      var detailCard=el('section',{class:'pcard itsm-detail-card'});
      if(!incidentSelected)detailCard.appendChild(el('div',{class:'itsm-detail-empty'},el('span',{class:'itsm-empty-icon'},'✦'),el('h3',{},'Incident command center'),el('p',{class:'m'},'Select an incident to review impact, coordinate ownership, update communications and track affected services.')));
      else if(!selected)detailCard.appendChild(el('p',{class:'m'},'Loading incident details…'));
      else {
        var d=selected, details=incidentDetail.services||[], related=incidentDetail.related||[];
        var impact=el('select',{'aria-label':'Impact'},[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].map(function(x){return el('option',{value:x[0]},x[1]);}));
        var urgency=el('select',{'aria-label':'Urgency'},[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].map(function(x){return el('option',{value:x[0]},x[1]);}));
        var sev=el('select',{'aria-label':'Severity'},[['P1','P1 · Critical'],['P2','P2 · High'],['P3','P3 · Moderate'],['P4','P4 · Low']].map(function(x){return el('option',{value:x[0]},x[1]);}));
        var commander=el('select',{'aria-label':'Incident commander'});commander.appendChild(el('option',{value:''},'Unassigned'));agents.forEach(function(a){if(a.role!=='light')commander.appendChild(el('option',{value:a.id},a.name||a.email));});
        impact.value=d.impact||'medium';urgency.value=d.urgency||'medium';sev.value=d.severity||'P3';commander.value=d.commander_id||'';
        var majorBox=el('input',{type:'checkbox','aria-label':'Mark as major incident'});majorBox.checked=!!d.is_major;
        var publicSummary=el('textarea',{rows:'3',maxlength:'3000','aria-label':'Public incident update',placeholder:'Customer-safe summary and current impact…'});publicSummary.value=d.public_summary||'';
        var internalSummary=el('textarea',{rows:'3',maxlength:'5000','aria-label':'Internal incident notes',placeholder:'Internal coordination notes, investigation and next actions…'});internalSummary.value=d.internal_summary||'';
        var nextUpdate=el('input',{type:'datetime-local','aria-label':'Next customer update'});if(d.next_update_at){var nd=new Date(d.next_update_at);nextUpdate.value=new Date(nd.getTime()-nd.getTimezoneOffset()*60000).toISOString().slice(0,16);}
        var affected=el('div',{class:'itsm-check-grid'});
        incidentServices.forEach(function(s){var cb=el('input',{type:'checkbox'});cb.checked=details.some(function(x){return Number(x.id)===Number(s.id);});cb.value=String(s.id);affected.appendChild(el('label',{class:'itsm-check'},cb,el('span',{},s.name,el('small',{},cap(s.status)+' · '+cap(s.criticality)))));});
        var relatedInput=el('input',{type:'text',placeholder:'e.g. 104, 108','aria-label':'Related incident ticket numbers',value:related.map(function(x){return x.number;}).join(', ')});
        var save=el('button',{type:'button',class:'btn',onclick:function(){
          var next=nextUpdate.value?new Date(nextUpdate.value):null;
          api('itsm-incident-save',{number:d.number,impact:impact.value,urgency:urgency.value,severity:sev.value,isMajor:majorBox.checked,commanderId:commander.value,publicSummary:publicSummary.value,internalSummary:internalSummary.value,nextUpdateAt:next&&Number.isFinite(next.getTime())?next.toISOString():null,serviceIds:Array.prototype.slice.call(affected.querySelectorAll('input:checked')).map(function(x){return Number(x.value);}),relatedNumbers:relatedInput.value.split(',').map(function(x){return Number(x.trim());}).filter(function(x){return Number.isSafeInteger(x)&&x>0;})}).then(function(r){if(!r.ok)return say(r.body.error||'Could not save incident.',true);incidentDetail=r.body;return api('itsm-incident-list',{limit:200,severity:incidentSeverity,majorOnly:incidentMajorOnly}).then(function(l){if(l.ok)incidentRows=l.body.incidents||[];draw();say('Incident updated.');});});
        }},'Save incident');
        detailCard.appendChild(el('div',{class:'itsm-detail-head'},el('div',{},el('span',{class:'itsm-kicker'},'INCIDENT #'+d.number),el('h3',{},d.subject),el('p',{class:'m'},(d.requester_name||d.requester_email||'Requester')+' · '+cap(d.status)+' · Updated '+ago(d.updated_at))),el('div',{class:'itsm-detail-actions'},el('span',{class:'itsm-severity '+String(d.severity||'P3').toLowerCase()},d.severity||'P3'),el('button',{type:'button',class:'btn l sm',onclick:function(){open(d.number);}},'Open ticket'))));
        detailCard.appendChild(el('div',{class:'itsm-field-grid'},el('label',{},el('span',{},'Impact'),impact),el('label',{},el('span',{},'Urgency'),urgency),el('label',{},el('span',{},'Severity'),sev),el('label',{},el('span',{},'Incident commander'),commander)));
        detailCard.appendChild(el('label',{class:'itsm-major-toggle'},majorBox,el('span',{},el('strong',{},'Major incident'),el('small',{},'Flag this incident for coordinated response and communication.'))));
        detailCard.appendChild(el('div',{class:'itsm-form-section'},el('h4',{},'Affected services'),affected));
        detailCard.appendChild(el('div',{class:'itsm-form-section'},el('h4',{},'Customer communications'),el('p',{class:'m'},'Use a customer-safe summary and set when the next update is expected.'),publicSummary,el('label',{class:'itsm-next-update'},el('span',{},'Next update'),nextUpdate)));
        detailCard.appendChild(el('div',{class:'itsm-form-section'},el('h4',{},'Internal coordination'),internalSummary,el('label',{},el('span',{},'Related incident numbers'),relatedInput)));
        detailCard.appendChild(el('div',{class:'itsm-save-row'},save,el('span',{class:'m'},'Changes are recorded in the ticket timeline.')));
      }
      return el('div',{class:'page wide itsm-page'},el('div',{class:'itsm-page-head'},el('div',{},el('span',{class:'itsm-kicker'},'SERVICE MANAGEMENT'),el('h2',{},'Incident management'),el('p',{class:'m'},'Coordinate service disruptions using the ticket, service and approval foundations already in EffDesk.')),el('div',{class:'itsm-head-actions'},el('span',{class:'itsm-plan-pill'},'PRO'),el('button',{type:'button',class:'btn',onclick:function(){closePanes();creating=true;newf=blankNew();newf.type='incident';pending=[];draw();}},'＋ Create incident'))),stats,el('div',{class:'itsm-layout'},el('div',{class:'itsm-main-col'},listCard,servicesCard),el('div',{class:'itsm-detail-col'},detailCard)));
    }



    // ── Change Management: risk, change calendar, sequential approvals and controlled implementation ──
    function loadChanges() {
      closePanes(); changesOpen=true; changeRows=null; changeDetail=null; changeSelected=0; changeCreating=false; changeLoading=true; changeApprovalStages=[]; draw();
      return Promise.all([api('itsm-change-list',{limit:200,status:changeStatus,risk:changeRisk}),api('itsm-services-list')]).then(function(rs){
        changeLoading=false;
        if(!rs[0].ok||!rs[1].ok){changeRows=[];changeServices=[];say((!rs[0].ok?rs[0].body.error:rs[1].body.error)||'Could not load changes.',true);}
        else{changeRows=rs[0].body.changes||[];changeServices=rs[1].body.services||[];}
        draw();
      });
    }
    function openChange(id) {
      changeSelected=Number(id)||0;changeCreating=false;changeDetail=null;draw();
      return api('itsm-change-get',{id:changeSelected}).then(function(r){
        if(!r.ok){changeSelected=0;say(r.body.error||'Could not load change request.',true);return;}
        changeDetail=r.body;changeApprovalStages=(r.body.change.approval_stages||[]).map(function(s){return {name:s.name||'',mode:s.mode||'all',approverIds:(s.approverIds||[]).slice()};});draw();
      });
    }
    function changeDateInput(v) {
      if(!v)return '';var d=new Date(v);if(!Number.isFinite(d.getTime()))return '';
      var pad=function(n){return String(n).padStart(2,'0');};
      return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
    }
    function changeDateLabel(v) { return v?new Date(v).toLocaleString():'Not scheduled'; }
    function loadCabPolicy() {
      cabPolicyLoading=true;draw();
      return api('itsm-change-policy-get').then(function(r){
        cabPolicyLoading=false;
        if(!r.ok){say(r.body.error||'Could not load CAB policy.',true);cabPolicyOpen=false;draw();return;}
        cabPolicy=r.body.policy;draw();
      });
    }
    function cabPolicyPane() {
      if(!cabPolicyOpen)return null;
      var p=cabPolicy||{conflictMode:'warn',emergencyConflictOverride:false,approvalMode:'all',requiredStages:{standard:0,normal:1,emergency:1},minApproversByRisk:{low:1,medium:1,high:2,critical:3},standardMaxRisk:'low',standardMaxImpact:'medium'};
      var conflictMode=el('select',{'aria-label':'Maintenance conflict handling'});
      [['warn','Warn and allow scheduling'],['block','Block scheduling until resolved']].forEach(function(x){conflictMode.appendChild(el('option',{value:x[0]},x[1]));});conflictMode.value=p.conflictMode||'warn';
      var override=el('input',{type:'checkbox','aria-label':'Allow emergency changes to override conflicts'});override.checked=!!p.emergencyConflictOverride;
      var approvalMode=el('select',{'aria-label':'CAB approval quorum'});[['all','All assigned approvers must approve'],['any','Any one assigned approver may approve']].forEach(function(x){approvalMode.appendChild(el('option',{value:x[0]},x[1]));});approvalMode.value=p.approvalMode||'all';
      function numberField(label,value,min,max){var n=el('input',{type:'number',min:String(min),max:String(max),step:'1','aria-label':label,value:String(value)});return el('label',{class:'change-policy-field'},el('span',{},label),n);}
      function riskSelect(label,value){var x=el('select',{'aria-label':label});[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].forEach(function(o){x.appendChild(el('option',{value:o[0]},o[1]));});x.value=value;return el('label',{class:'change-policy-field'},el('span',{},label),x);}
      var stages={standard:numberField('Standard · minimum stages',p.requiredStages.standard,0,10),normal:numberField('Normal · minimum stages',p.requiredStages.normal,0,10),emergency:numberField('Emergency · minimum stages',p.requiredStages.emergency,0,10)};
      var approvers={low:numberField('Low risk · minimum approvers per stage',p.minApproversByRisk.low,1,30),medium:numberField('Medium risk · minimum approvers per stage',p.minApproversByRisk.medium,1,30),high:numberField('High risk · minimum approvers per stage',p.minApproversByRisk.high,1,30),critical:numberField('Critical risk · minimum approvers per stage',p.minApproversByRisk.critical,1,30)};
      var maxRisk=riskSelect('Standard pre-approval · maximum risk',p.standardMaxRisk||'low'),maxImpact=riskSelect('Standard pre-approval · maximum impact',p.standardMaxImpact||'medium');
      var save=el('button',{type:'button',class:'btn',onclick:function(){
        var read=function(x){return Number(x.querySelector('input').value);};
        var next={conflictMode:conflictMode.value,emergencyConflictOverride:override.checked,approvalMode:approvalMode.value,
          requiredStages:{standard:read(stages.standard),normal:read(stages.normal),emergency:read(stages.emergency)},
          minApproversByRisk:{low:read(approvers.low),medium:read(approvers.medium),high:read(approvers.high),critical:read(approvers.critical)},
          standardMaxRisk:maxRisk.querySelector('select').value,standardMaxImpact:maxImpact.querySelector('select').value};
        api('itsm-change-policy-save',{policy:next}).then(function(r){if(!r.ok)return say(r.body.error||'Could not save CAB policy.',true);cabPolicy=r.body.policy;draw();say('CAB policy saved.');});
      }},'Save CAB policy');
      return el('section',{class:'pcard change-policy-card'},el('div',{class:'itsm-card-head'},el('div',{},el('h3',{},'Configurable CAB policy'),el('p',{class:'m'},'Set approval thresholds and maintenance-window conflict handling for this workspace.')),el('button',{type:'button',class:'btn l sm',onclick:function(){cabPolicyOpen=false;draw();}},'Close')),
        cabPolicyLoading?el('p',{class:'m'},'Loading CAB policy…'):null,
        el('div',{class:'change-policy-grid'},el('label',{class:'change-policy-field'},el('span',{},'Overlapping changes on the same service'),conflictMode),el('label',{class:'change-policy-field'},el('span',{},'Approval quorum for each CAB stage'),approvalMode),el('label',{class:'change-policy-check'},override,el('span',{},'Allow emergency changes to override a blocking conflict')),stages.standard,stages.normal,stages.emergency,approvers.low,approvers.medium,approvers.high,approvers.critical,maxRisk,maxImpact),
        el('div',{class:'itsm-save-row'},save));
    }
    function changesPane() {
      var rows=changeRows||[];
      var active=rows.filter(function(x){return ['submitted','assessing','awaiting_approval','approved','scheduled','implementing'].indexOf(x.status)>=0;}).length;
      var awaiting=rows.filter(function(x){return x.status==='awaiting_approval';}).length;
      var highRisk=rows.filter(function(x){return x.risk==='high'||x.risk==='critical';}).length;
      var upcoming=rows.filter(function(x){return x.planned_start&&new Date(x.planned_start)>=new Date()&&['approved','scheduled'].indexOf(x.status)>=0;}).length;
      var stats=el('div',{class:'stats itsm-stats'},
        el('div',{class:'stat'},el('div',{class:'sv'},String(rows.length)),el('div',{class:'sl'},'Change requests')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(awaiting)),el('div',{class:'sl'},'Awaiting approval')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(highRisk)),el('div',{class:'sl'},'High / critical risk')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(upcoming)),el('div',{class:'sl'},'Upcoming windows')));
      var statusFilter=el('select',{'aria-label':'Filter changes by status'});
      [['','All statuses'],['draft','Draft'],['submitted','Submitted'],['assessing','Assessing'],['awaiting_approval','Awaiting approval'],['approved','Approved'],['rejected','Rejected'],['scheduled','Scheduled'],['implementing','Implementing'],['completed','Completed'],['failed','Failed'],['cancelled','Cancelled']].forEach(function(x){var o=el('option',{value:x[0]},x[1]);o.selected=x[0]===changeStatus;statusFilter.appendChild(o);});
      statusFilter.addEventListener('change',function(){changeStatus=statusFilter.value;refreshChangeList();});
      var riskFilter=el('select',{'aria-label':'Filter changes by risk'});
      [['','All risk levels'],['critical','Critical'],['high','High'],['medium','Medium'],['low','Low']].forEach(function(x){var o=el('option',{value:x[0]},x[1]);o.selected=x[0]===changeRisk;riskFilter.appendChild(o);});
      riskFilter.addEventListener('change',function(){changeRisk=riskFilter.value;refreshChangeList();});
      var list=el('div',{class:'itsm-table-wrap'});


      if(changeLoading)list.appendChild(el('p',{class:'m'},'Loading change requests…'));
      else if(!rows.length)list.appendChild(el('div',{class:'itsm-detail-empty'},el('h3',{},'No change requests yet'),el('p',{class:'m'},'Create a change request to assess risk, plan a maintenance window and coordinate approvals.')));
      else {
        var tbl=el('table',{class:'itsm-table change-table'});
        tbl.appendChild(el('thead',{},el('tr',{},['Change','Type','Risk','Status','Window','Owner'].map(function(x){return el('th',{},x);}))));
        var body=el('tbody');
        rows.forEach(function(x){
          var tr=el('tr',{class:changeSelected===Number(x.id)?'selected':'',tabindex:'0',role:'button','aria-label':'Open change CHG-'+x.id+' '+x.title});
          tr.appendChild(el('td',{},el('strong',{},'CHG-'+x.id+' · '+x.title),el('span',{class:'itsm-subline'},(x.service_count||0)+' services · '+(x.incident_count||0)+' incidents')));
          tr.appendChild(el('td',{},cap(x.change_type)));
          tr.appendChild(el('td',{},el('span',{class:'itsm-severity '+String(x.risk||'medium').toLowerCase()},cap(x.risk))));
          tr.appendChild(el('td',{},el('span',{class:'badge s-'+(x.status==='completed'?'solved':x.status==='rejected'||x.status==='failed'?'closed':x.status==='awaiting_approval'?'pending':'open')},cap(x.status.replace(/_/g,' ')))));
          tr.appendChild(el('td',{},changeDateLabel(x.planned_start)));
          tr.appendChild(el('td',{},x.owner_name||x.owner_email||'Unassigned'));
          var choose=function(){openChange(x.id);};tr.addEventListener('click',choose);tr.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});body.appendChild(tr);
        });
        tbl.appendChild(body);list.appendChild(tbl);
      }
      var listCard=el('section',{class:'pcard itsm-list-card'},el('div',{class:'itsm-card-head'},el('div',{},el('h3',{},'Change register'),el('p',{class:'m'},'Review proposed work, risk, approvals and upcoming maintenance windows.')),el('div',{class:'itsm-toolbar'},statusFilter,riskFilter,el('button',{type:'button',class:'btn l sm',onclick:loadChanges},'Refresh'))),list);
      var detail=el('section',{class:'pcard itsm-detail-card change-detail-card'});
      var ch=changeDetail&&changeDetail.change;
      if(!changeCreating&&!changeSelected)detail.appendChild(el('div',{class:'itsm-detail-empty'},el('span',{class:'itsm-empty-icon'},'↗'),el('h3',{},'Change workspace'),el('p',{class:'m'},'Select a change request or create one to assess risk, define implementation and rollback plans, and schedule a controlled release.')));
      else if(changeSelected&&!ch)detail.appendChild(el('p',{class:'m'},'Loading change request…'));
      else {
        ch=ch||{title:'',description:'',change_type:'normal',status:'draft',risk:'medium',impact:'medium',implementation_plan:'',test_plan:'',rollback_plan:'',outcome:'',owner_id:'',approval_stages:[]};
        var pendingApproval=ch.status==='awaiting_approval',terminal=['completed','failed','cancelled'].indexOf(ch.status)>=0;
        var title=el('input',{type:'text',maxlength:'180',placeholder:'Change title','aria-label':'Change title',value:ch.title||''});
        var description=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Describe the proposed change, reason and scope…','aria-label':'Change description'});description.value=ch.description||'';
        var type=el('select',{'aria-label':'Change type'});[['standard','Standard'],['normal','Normal'],['emergency','Emergency']].forEach(function(x){type.appendChild(el('option',{value:x[0]},x[1]));});type.value=ch.change_type||'normal';
        var status=el('select',{'aria-label':'Change status'});
        var allowed={draft:['draft','submitted','assessing','awaiting_approval','cancelled'],submitted:['submitted','assessing','awaiting_approval','approved','cancelled'],assessing:['assessing','awaiting_approval','approved','cancelled'],awaiting_approval:['awaiting_approval','cancelled'],approved:['approved','scheduled','cancelled'],rejected:['rejected','draft','cancelled'],scheduled:['scheduled','implementing','cancelled'],implementing:['implementing','completed','failed'],completed:['completed'],failed:['failed'],cancelled:['cancelled']};
        (allowed[ch.status]||[ch.status]).forEach(function(x){status.appendChild(el('option',{value:x},cap(x.replace(/_/g,' '))));});status.value=ch.status||'draft';
        var risk=el('select',{'aria-label':'Change risk'});[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].forEach(function(x){risk.appendChild(el('option',{value:x[0]},x[1]));});risk.value=ch.risk||'medium';
        var impact=el('select',{'aria-label':'Change impact'});[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']].forEach(function(x){impact.appendChild(el('option',{value:x[0]},x[1]));});impact.value=ch.impact||'medium';
        var owner=el('select',{'aria-label':'Change owner'});owner.appendChild(el('option',{value:''},'Unassigned'));agents.forEach(function(a){if(a.role!=='light')owner.appendChild(el('option',{value:a.id},a.name||a.email));});owner.value=ch.owner_id||'';
        var start=el('input',{type:'datetime-local','aria-label':'Planned start',value:changeDateInput(ch.planned_start)});
        var end=el('input',{type:'datetime-local','aria-label':'Planned end',value:changeDateInput(ch.planned_end)});
        var implementation=el('textarea',{rows:'4',maxlength:'8000',placeholder:'Step-by-step implementation plan…','aria-label':'Implementation plan'});implementation.value=ch.implementation_plan||'';
        var testing=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Validation steps and success criteria…','aria-label':'Test plan'});testing.value=ch.test_plan||'';
        var rollback=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Rollback triggers and recovery steps…','aria-label':'Rollback plan'});rollback.value=ch.rollback_plan||'';
        var outcome=el('textarea',{rows:'2',maxlength:'5000',placeholder:'Record the outcome after implementation…','aria-label':'Change outcome'});outcome.value=ch.outcome||'';
        var serviceSelect=el('select',{multiple:true,'aria-label':'Affected services',size:Math.min(5,Math.max(3,changeServices.length))});
        changeServices.forEach(function(s){var o=el('option',{value:s.id},s.name+' · '+cap(s.criticality));o.selected=(changeDetail&&changeDetail.services||[]).some(function(x){return Number(x.id)===Number(s.id);});serviceSelect.appendChild(o);});
        var incidentInput=el('input',{type:'text',placeholder:'Incident ticket numbers, separated by commas','aria-label':'Related incident numbers',value:(changeDetail&&changeDetail.incidents||[]).map(function(x){return x.number;}).join(', ')});
        var conflictPreview=el('div',{class:'change-conflict-preview'});
        var checkConflicts=el('button',{type:'button',class:'btn l sm',onclick:function(){
          var selectedServices=Array.prototype.filter.call(serviceSelect.options,function(o){return o.selected;}).map(function(o){return Number(o.value);});
          api('itsm-change-conflicts',{id:changeSelected||0,plannedStart:start.value||null,plannedEnd:end.value||null,serviceIds:selectedServices}).then(function(r){
            conflictPreview.textContent='';
            if(!r.ok){conflictPreview.appendChild(el('p',{class:'m'},r.body.error||'Could not check this window.'));return;}
            if(!r.body.conflicts.length){conflictPreview.appendChild(el('p',{class:'m'},'No overlapping changes found for the selected services and window.'));return;}
            conflictPreview.appendChild(el('strong',{},r.body.conflicts.length+' overlapping change(s) found'));
            r.body.conflicts.forEach(function(x){conflictPreview.appendChild(el('div',{class:'change-conflict-row'},el('b',{},'CHG-'+x.id+' · '+x.title),el('span',{class:'m'},cap(x.status)+' · '+changeDateLabel(x.planned_start)+' – '+changeDateLabel(x.planned_end)),el('small',{},(x.shared_services||[]).join(', '))));});
          });
        }},'Check maintenance conflicts');
        var approvalBox=el('div',{class:'change-approval-stages'});
        function renderStages(){
          approvalBox.textContent='';
          changeApprovalStages.forEach(function(stage,ix){
            var name=el('input',{type:'text',maxlength:'80',placeholder:'Stage '+(ix+1)+' name',value:stage.name||('Stage '+(ix+1)),disabled:pendingApproval});
            var mode=el('select',{'aria-label':'Approval rule for stage '+(ix+1),disabled:pendingApproval});[['all','All approvers'],['any','Any one approver']].forEach(function(x){mode.appendChild(el('option',{value:x[0]},x[1]));});mode.value=stage.mode||'all';
            var people=el('select',{multiple:true,disabled:pendingApproval,size:Math.min(5,Math.max(3,agents.filter(function(a){return a.role!=='light';}).length)),'aria-label':'Approvers for stage '+(ix+1)});
            agents.forEach(function(a){if(a.role!=='light'){var o=el('option',{value:a.id},a.name||a.email);o.selected=(stage.approverIds||[]).indexOf(a.id)>=0;people.appendChild(o);}});
            var remove=el('button',{type:'button',class:'btn l sm',disabled:pendingApproval,onclick:function(){changeApprovalStages.splice(ix,1);renderStages();}},'Remove stage');
            approvalBox.appendChild(el('div',{class:'change-stage-card'},el('div',{class:'change-stage-head'},el('strong',{},'Stage '+(ix+1)),remove),name,mode,people));
            stage._controls={name:name,mode:mode,people:people};
          });
        }
        if(!changeApprovalStages.length&&!pendingApproval)changeApprovalStages=[{name:'CAB review',mode:'all',approverIds:[]}];
        renderStages();
        var addStage=el('button',{type:'button',class:'btn l sm',disabled:pendingApproval||changeApprovalStages.length>=10,onclick:function(){changeApprovalStages.push({name:'Stage '+(changeApprovalStages.length+1),mode:'all',approverIds:[]});renderStages();}},'＋ Add approval stage');
        var save=el('button',{type:'button',class:'btn',disabled:terminal,onclick:function(){
          if(!title.value.trim())return say('Give the change request a title.',true);
          var stages=changeApprovalStages.map(function(s){return {name:s._controls?s._controls.name.value:s.name,mode:s._controls?s._controls.mode.value:s.mode,approverIds:s._controls?Array.prototype.filter.call(s._controls.people.options,function(o){return o.selected;}).map(function(o){return o.value;}):s.approverIds};});
          var services=Array.prototype.filter.call(serviceSelect.options,function(o){return o.selected;}).map(function(o){return Number(o.value);});
          var incidents=incidentInput.value.split(',').map(function(x){return Number(x.trim());}).filter(function(x){return Number.isSafeInteger(x)&&x>0;});
          api('itsm-change-save',{id:changeSelected||undefined,title:title.value,description:description.value,changeType:type.value,status:status.value,risk:risk.value,impact:impact.value,plannedStart:start.value||null,plannedEnd:end.value||null,implementationPlan:implementation.value,testPlan:testing.value,rollbackPlan:rollback.value,outcome:outcome.value,ownerId:owner.value,serviceIds:services,incidentNumbers:incidents,approvalStages:stages}).then(function(r){
            if(!r.ok){if(r.body&&Array.isArray(r.body.conflicts)){changeDetail=changeDetail||{change:ch,services:[],incidents:[],decisions:[],events:[]};changeDetail.conflicts=r.body.conflicts;draw();}return say(r.body.error||'Could not save change request.',true);}
            changeSelected=Number(r.body.change.id);changeCreating=false;changeDetail=r.body;
            return refreshChangeList(false).then(function(){draw();say('Change request saved.');});
          });
        }},changeCreating?'Create change request':'Save changes');
        detail.appendChild(el('div',{class:'itsm-detail-head'},el('div',{},el('span',{class:'itsm-kicker'},changeCreating?'NEW CHANGE':'CHANGE CHG-'+ch.id),el('h3',{},changeCreating?'New change request':ch.title||'Change request'),el('p',{class:'m'},'Created '+changeDateLabel(ch.created_at)+' · Updated '+changeDateLabel(ch.updated_at))),el('div',{class:'itsm-detail-actions'},changeSelected?el('button',{type:'button',class:'btn l sm',onclick:function(){openChange(changeSelected);}},'Reload'):null)));
        detail.appendChild(el('div',{class:'change-form-grid'},el('label',{},el('span',{},'Title'),title),el('label',{},el('span',{},'Type'),type),el('label',{},el('span',{},'Status'),status),el('label',{},el('span',{},'Risk'),risk),el('label',{},el('span',{},'Impact'),impact),el('label',{},el('span',{},'Change owner'),owner),el('label',{},el('span',{},'Planned start'),start),el('label',{},el('span',{},'Planned end'),end)));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Description and business justification'),description));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Implementation plan'),implementation));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Test and validation plan'),testing));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Rollback plan'),rollback));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Affected business services'),el('p',{class:'m'},'Select services impacted by this change. Use Ctrl/Cmd to select multiple.'),serviceSelect,checkConflicts,conflictPreview));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Related incidents'),el('p',{class:'m'},'Link incident ticket numbers from this workspace.'),incidentInput));
        detail.appendChild(el('div',{class:'problem-form-section'},el('div',{class:'change-stage-title'},el('h4',{},'Sequential approval stages'),el('span',{class:'m'},pendingApproval?'Approval stages are locked while decisions are in progress.':'All stages must complete in order.')),approvalBox,addStage));
        if(pendingApproval&&changeDetail){
          var ix=Math.max(0,Math.min(Number(ch.current_stage)||0,(ch.approval_stages||[]).length-1)),stage=(ch.approval_stages||[])[ix]||{};
          var already=(changeDetail.decisions||[]).some(function(d){return Number(d.round_index)===Number(ch.approval_round||1)&&Number(d.stage_index)===ix&&d.approver_id===meId;});
          if((stage.approverIds||[]).indexOf(meId)>=0&&!already){
            var comment=el('textarea',{rows:'2',maxlength:'2000',placeholder:'Optional approval comment…','aria-label':'Approval comment'});
            var actions=el('div',{class:'change-decision-actions'},comment,
              el('button',{type:'button',class:'btn',onclick:function(){api('itsm-change-decide',{id:ch.id,decision:'approved',comment:comment.value}).then(function(r){if(!r.ok)return say(r.body.error||'Could not approve change.',true);changeDetail=r.body;refreshChangeList(false).then(draw);say('Change approved.');});}},'Approve'),
              el('button',{type:'button',class:'btn l',onclick:function(){api('itsm-change-decide',{id:ch.id,decision:'rejected',comment:comment.value}).then(function(r){if(!r.ok)return say(r.body.error||'Could not reject change.',true);changeDetail=r.body;refreshChangeList(false).then(draw);say('Change rejected.');});}},'Reject'));
            detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Your approval is required'),actions));
          }
        }
        if(changeDetail&&changeDetail.conflicts&&changeDetail.conflicts.length){
          var conflicts=el('div',{class:'problem-form-section change-conflicts'},el('h4',{},'Maintenance-window conflicts'),el('p',{class:'m'},'These approved or in-flight changes overlap this window on one or more selected services.'));
          changeDetail.conflicts.forEach(function(x){conflicts.appendChild(el('div',{class:'change-conflict-row'},el('strong',{},'CHG-'+x.id+' · '+x.title),el('span',{class:'m'},cap(x.status)+' · '+changeDateLabel(x.planned_start)+' – '+changeDateLabel(x.planned_end)),el('small',{},(x.shared_services||[]).join(', '))));});
          detail.appendChild(conflicts);
        }
        if(changeDetail&&changeDetail.decisions&&changeDetail.decisions.length){
          var history=el('div',{class:'problem-history'},el('h4',{},'Approval decisions'));
          changeDetail.decisions.forEach(function(x){var s=(ch.approval_stages||[])[x.stage_index]||{};var a=agents.filter(function(v){return v.id===x.approver_id;})[0];history.appendChild(el('div',{class:'problem-history-item'},el('strong',{},a?a.name||a.email:x.approver_id),el('span',{class:'m'},'Round '+(x.round_index||1)+' · '+(s.name||'Stage '+(x.stage_index+1))+' · '+x.decision+(x.comment?' · '+x.comment:'')),el('small',{},changeDateLabel(x.created_at))));});detail.appendChild(history);
        }
        if(changeDetail&&changeDetail.events&&changeDetail.events.length){
          var activity=el('div',{class:'problem-history'},el('h4',{},'Change activity'));
          changeDetail.events.forEach(function(x){activity.appendChild(el('div',{class:'problem-history-item'},el('strong',{},x.actor_name||'System'),el('span',{class:'m'},x.detail),el('small',{},changeDateLabel(x.created_at))));});detail.appendChild(activity);
        }
        detail.appendChild(el('div',{class:'itsm-save-row'},save));
        if(ch.status==='implementing'||ch.status==='completed'||ch.status==='failed'){
          detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Implementation outcome'),outcome));
        }
      }
      var upcoming=rows.filter(function(x){return x.planned_start&&['approved','scheduled','implementing'].indexOf(x.status)>=0;}).sort(function(a,b){return new Date(a.planned_start)-new Date(b.planned_start);}).slice(0,8);
      var calendar=el('section',{class:'pcard change-calendar'},el('h3',{},'Upcoming maintenance windows'),el('p',{class:'m'},'Approved and scheduled changes with planned start and end times.'));
      if(!upcoming.length)calendar.appendChild(el('p',{class:'m'},'No approved maintenance windows are scheduled.'));
      upcoming.forEach(function(x){calendar.appendChild(el('button',{type:'button',class:'change-calendar-row',onclick:function(){openChange(x.id);}},el('span',{class:'change-calendar-date'},changeDateLabel(x.planned_start)),el('span',{class:'change-calendar-title'},el('strong',{},'CHG-'+x.id+' · '+x.title),el('small',{},changeDateLabel(x.planned_end))),el('span',{class:'itsm-severity '+String(x.risk||'medium').toLowerCase()},cap(x.risk))));});
      return el('div',{class:'page wide itsm-page changes-page'},el('div',{class:'itsm-page-head'},el('div',{},el('span',{class:'itsm-kicker'},'SERVICE MANAGEMENT'),el('h2',{},'Change management'),el('p',{class:'m'},'Assess risk, coordinate approvals and schedule controlled service changes.')),el('div',{class:'itsm-head-actions'},el('span',{class:'itsm-plan-pill'},'PRO'),(role==='owner'||role==='admin')?el('button',{type:'button',class:'btn l',onclick:function(){cabPolicyOpen=!cabPolicyOpen;if(cabPolicyOpen)loadCabPolicy();else draw();}},'CAB policy'):null,el('button',{type:'button',class:'btn',onclick:function(){closePanes();changesOpen=true;changeCreating=true;changeSelected=0;changeDetail=null;changeApprovalStages=[{name:'CAB review',mode:'all',approverIds:[]}];draw();}},'＋ New change'))),cabPolicyPane(),stats,el('div',{class:'itsm-layout change-layout'},el('div',{class:'itsm-main-col'},listCard,calendar),el('div',{class:'itsm-detail-col'},detail)));
    }
    function refreshChangeList(redraw) {
      changeLoading=true;if(redraw!==false)draw();
      return api('itsm-change-list',{limit:200,status:changeStatus,risk:changeRisk}).then(function(r){changeLoading=false;if(!r.ok){say(r.body.error||'Could not refresh changes.',true);return;}changeRows=r.body.changes||[];if(redraw!==false)draw();});
    }

    // ── Problem management: root-cause records linked to existing incidents ──
    function loadConfigurationItems(){
      closePanes();ciOpen=true;ciRows=null;ciDetail=null;ciSelected=0;ciEditing=null;ciLoading=true;draw();
      return Promise.all([api('itsm-ci-list',{limit:500}),api('itsm-services-list'),api('itsm-ci-vendors-list'),api('itsm-ci-contracts-list'),api('itsm-ci-licenses-list'),api('itsm-ci-warranty-report',{days:90}),api('itsm-ci-discovery-status'),api('itsm-ci-agent-list')]).then(function(rs){
        ciLoading=false;
        if(!rs[0].ok||!rs[1].ok){ciRows=[];ciServices=[];say((!rs[0].ok?rs[0].body.error:rs[1].body.error)||'Could not load assets.',true);}
        else{ciRows=rs[0].body.items||[];ciServices=rs[1].body.services||[];ciVendors=rs[2].ok?(rs[2].body.vendors||[]):[];ciContracts=rs[3].ok?(rs[3].body.contracts||[]):[];ciLicenses=rs[4].ok?(rs[4].body.licenses||[]):[];ciWarranty=rs[5].ok?(rs[5].body.items||[]):[];ciDiscoveryStatus=rs[6].ok?rs[6].body:null;ciDiscoveryAgents=rs[7].ok?(rs[7].body.agents||[]):[];ciDiscoverySoftware=rs[7].ok?(rs[7].body.softwareItems||[]):[];}
        draw();
      });
    }
    function openConfigurationItem(id){
      ciSelected=Number(id)||0;ciEditing=null;ciDetail=null;draw();
      return api('itsm-ci-get',{id:ciSelected}).then(function(r){
        if(!r.ok){ciSelected=0;say(r.body.error||'Could not load configuration item.',true);return;}
        ciDetail=r.body;draw();
      });
    }
    function configurationItemsPane(){
      var rows=ciRows||[],active=rows.filter(function(x){return ['in_use','in_repair'].indexOf(x.lifecycle)>=0;}).length;
      var critical=rows.filter(function(x){return x.criticality==='critical'||x.criticality==='high';}).length;
      var warranty=rows.filter(function(x){return x.warranty_expires_at&&new Date(x.warranty_expires_at+'T00:00:00')>=new Date()&&new Date(x.warranty_expires_at+'T00:00:00')<new Date(Date.now()+90*86400000);}).length;
      var stats=el('div',{class:'stats itsm-stats'},
        el('div',{class:'stat'},el('div',{class:'sv'},String(rows.length)),el('div',{class:'sl'},'Configuration items')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(active)),el('div',{class:'sl'},'In use / repair')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(critical)),el('div',{class:'sl'},'High criticality')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(warranty)),el('div',{class:'sl'},'Warranty due in 90 days')));
      var list=el('div',{class:'itsm-table-wrap'});
      if(ciLoading)list.appendChild(el('p',{class:'m'},'Loading configuration items…'));
      else if(!rows.length)list.appendChild(el('div',{class:'itsm-detail-empty'},el('h3',{},'No assets or configuration items yet'),el('p',{class:'m'},'Start with laptops, servers, applications and other components. You can connect them to business services and map dependencies.')));
      else{
        var tbl=el('table',{class:'itsm-table'});
        tbl.appendChild(el('thead',{},el('tr',{},['Asset tag','Configuration item','Type','Lifecycle','Criticality','Business service','Source','Operating system','Compliance','Dependencies'].map(function(x){return el('th',{},x);}))));
        var body=el('tbody');
        rows.forEach(function(x){var tr0=el('tr',{class:ciSelected===Number(x.id)?'selected':'',tabindex:'0',role:'button','aria-label':'Open '+x.name,onclick:function(){openConfigurationItem(x.id);}});
          [x.asset_tag||'—',el('strong',{},x.name),cap(x.ci_type),cap(x.lifecycle),el('span',{class:'itsm-severity '+String(x.criticality||'medium').toLowerCase()},cap(x.criticality)),x.service_name||'—',x.discovery_source?cap(x.discovery_source):'Manual',x.operating_system?(x.operating_system+' '+(x.os_version||'')):'—',x.compliance_state?cap(x.compliance_state):'—',String(x.relationship_count||0)].forEach(function(v){tr0.appendChild(el('td',{},v));});
          body.appendChild(tr0);
        });tbl.appendChild(body);list.appendChild(tbl);
      }
      var detail=el('div',{class:'pcard itsm-detail-empty'},el('h3',{},'Select a configuration item'),el('p',{class:'m'},'Review ownership, lifecycle, service association, dependencies and linked work.'));
      var item=ciEditing||(ciDetail&&ciDetail.item);
      if(item){
        var isNew=!item.id,field=function(label,value,type,max){var x=el(type==='textarea'?'textarea':'input',{ 'aria-label':label, ...(type==='textarea'?{rows:'3'}:{type:type||'text'}),maxlength:String(max||240)});x.value=value||'';return x;};
        var name=field('Name',item.name),tag=field('Asset tag',item.asset_tag||item.assetTag),desc=field('Description',item.description,'textarea',5000);
        var type=sel('Configuration item type',item.ci_type||item.ciType||'hardware',[['hardware','Hardware'],['software','Software'],['application','Application'],['database','Database'],['network','Network'],['cloud_resource','Cloud resource'],['service','Service'],['other','Other']],function(){});
        var life=sel('Lifecycle',item.lifecycle||'in_use',[['planned','Planned'],['in_use','In use'],['in_repair','In repair'],['retired','Retired'],['disposed','Disposed']],function(){});
        var crit=sel('Criticality',item.criticality||'medium',[['low','Low'],['medium','Medium'],['high','High'],['critical','Critical']],function(){});
        var manufacturer=field('Manufacturer',item.manufacturer),model=field('Model',item.model),serial=field('Serial number',item.serial_number||item.serialNumber),location=field('Location',item.location);
        var purchase=field('Purchase date',item.purchase_date||item.purchaseDate,'date'),warranty=field('Warranty expiry',item.warranty_expires_at||item.warrantyExpiresAt,'date');
        var owner=sel('Owner',item.owner_id||item.ownerId||'', [['','Unassigned']].concat(agents.filter(function(a){return a.role!=='light';}).map(function(a){return [a.id,a.name||a.email];})),function(){});
        var service=sel('Business service',String(item.business_service_id||item.businessServiceId||''),[['','No service']].concat(ciServices.map(function(x){return [String(x.id),x.name];})),function(){});
        var vendor=sel('Vendor',String(item.vendor_id||item.vendorId||''),[['','No vendor']].concat(ciVendors.map(function(x){return [String(x.id),x.name];})),function(){});
        var contract=sel('Contract',String(item.contract_id||item.contractId||''),[['','No contract']].concat(ciContracts.map(function(x){return [String(x.id),x.name];})),function(){});
        var save=el('button',{type:'button',class:'btn',onclick:function(){
          api('itsm-ci-save',{id:item.id,assetTag:tag.value,name:name.value,description:desc.value,ciType:type.value,lifecycle:life.value,criticality:crit.value,manufacturer:manufacturer.value,model:model.value,serialNumber:serial.value,location:location.value,ownerId:owner.value,businessServiceId:service.value,vendorId:vendor.value,contractId:contract.value,purchaseDate:purchase.value,warrantyExpiresAt:warranty.value}).then(function(r){
            if(!r.ok)return say(r.body.error||'Could not save configuration item.',true);
            say('Configuration item saved.');ciEditing=null;return loadConfigurationItems().then(function(){return openConfigurationItem(r.body.item.id);});
          });
        }},'Save configuration item');
        detail=el('div',{class:'pcard'},el('div',{class:'bar'},el('div',{},el('span',{class:'itsm-kicker'},isNew?'NEW ASSET':'CONFIGURATION ITEM'),el('h3',{},isNew?'Add asset or CI':item.name)),el('span',{class:'grow'}),el('button',{type:'button',class:'btn l sm',onclick:function(){ciEditing=null;ciDetail=null;ciSelected=0;draw();}},'Close')),
          el('div',{class:'problem-form-grid'},el('label',{},el('span',{},'Name'),name),el('label',{},el('span',{},'Asset tag'),tag),el('label',{},el('span',{},'Type'),type),el('label',{},el('span',{},'Lifecycle'),life),el('label',{},el('span',{},'Criticality'),crit),el('label',{},el('span',{},'Owner'),owner),el('label',{},el('span',{},'Business service'),service),el('label',{},el('span',{},'Vendor'),vendor),el('label',{},el('span',{},'Contract'),contract),el('label',{},el('span',{},'Manufacturer'),manufacturer),el('label',{},el('span',{},'Model'),model),el('label',{},el('span',{},'Serial number'),serial),el('label',{},el('span',{},'Location'),location),el('label',{},el('span',{},'Purchase date'),purchase),el('label',{},el('span',{},'Warranty expiry'),warranty)),
          el('div',{class:'problem-form-section'},el('h4',{},'Description'),desc),el('div',{class:'itsm-save-row'},save));
        if(!isNew&&item.discovery_source==='intune')detail.appendChild(el('div',{class:'pcard'},el('h4',{},'Microsoft Intune discovery'),el('p',{class:'m'},'Source: Microsoft Intune · '+cap(item.discovery_status||'current')),el('p',{class:'m'},'Operating system: '+[item.operating_system,item.os_version].filter(Boolean).join(' ')+' · Compliance: '+(item.compliance_state||'Unknown')),el('p',{class:'m'},'Last seen: '+(item.discovery_last_seen_at?new Date(item.discovery_last_seen_at).toLocaleString():'Not available'))));
        if(!isNew&&ciDetail){
          var target=sel('Related CI','',[['','Choose a configuration item']].concat(rows.filter(function(x){return Number(x.id)!==Number(item.id);}).map(function(x){return [String(x.id),x.name];})),function(){});
          var rel=sel('Relationship','depends_on',[['depends_on','Depends on'],['runs_on','Runs on'],['hosted_on','Hosted on'],['connects_to','Connects to'],['managed_by','Managed by']],function(){});
          var relBox=el('div',{class:'pcard'},el('h4',{},'Service map relationships'),el('p',{class:'m'},'Create a directed relationship from this item to another configuration item.'),el('div',{class:'bar'},target,rel,el('button',{type:'button',class:'btn sm',onclick:function(){if(!target.value)return say('Choose a related configuration item.',true);api('itsm-ci-relationship-save',{sourceCiId:item.id,targetCiId:target.value,relationship:rel.value}).then(function(r){if(!r.ok)return say(r.body.error,true);openConfigurationItem(item.id);});}},'Add relationship')));
          (ciDetail.relationships||[]).forEach(function(x){relBox.appendChild(el('p',{class:'m'},x.source_name+' — '+cap(x.relationship)+' → '+x.target_name));});
          var rt=sel('Record type','ticket',[['ticket','Ticket'],['problem','Problem'],['change','Change']],function(){}),rid=field('Record ID','','number',12);
          var linkBox=el('div',{class:'pcard'},el('h4',{},'Linked work'),el('p',{class:'m'},'Associate this CI with existing tickets, problems or change requests in this workspace.'),el('div',{class:'bar'},rt,rid,el('button',{type:'button',class:'btn sm',onclick:function(){api('itsm-ci-record-link',{ciId:item.id,recordType:rt.value,recordId:rid.value}).then(function(r){if(!r.ok)return say(r.body.error,true);openConfigurationItem(item.id);});}},'Link record')));
          (ciDetail.tickets||[]).forEach(function(x){linkBox.appendChild(el('p',{class:'m'},'Ticket #'+x.number+' · '+x.subject+' · '+cap(x.status)));});
          (ciDetail.problems||[]).forEach(function(x){linkBox.appendChild(el('p',{class:'m'},'Problem #'+x.id+' · '+x.title+' · '+cap(x.status)));});
          (ciDetail.changes||[]).forEach(function(x){linkBox.appendChild(el('p',{class:'m'},'Change CHG-'+x.id+' · '+x.title+' · '+cap(x.status)));});
          detail.appendChild(relBox);detail.appendChild(linkBox);
          if((ciDetail.events||[]).length){var hist=el('div',{class:'problem-history'},el('h4',{},'CI activity'));ciDetail.events.forEach(function(e){hist.appendChild(el('div',{class:'problem-history-item'},el('strong',{},e.actor_name||'System'),el('span',{class:'m'},e.detail),el('small',{},ago(e.created_at))));});detail.appendChild(hist);}
        }
      }
      var lifecycle=el('section',{class:'pcard'},el('div',{class:'itsm-card-head'},el('div',{},el('h3',{},'Procurement & lifecycle'),el('p',{class:'m'},'Manage suppliers, commercial agreements, software entitlements and upcoming warranty dates.'))));
      var actions=el('div',{class:'itsm-toolbar'});
      var exportBtn=el('button',{type:'button',class:'btn l sm',onclick:function(){api('itsm-ci-export-csv').then(function(r){if(!r.ok)return say(r.body.error||'Could not export assets.',true);saveFile(r.body.filename||'effdesk-assets.csv',r.body.csv||'','text/csv;charset=utf-8');say('Asset CSV exported.');});}},'Export CSV');
      if(isAdmin)actions.appendChild(exportBtn);
      if(isAdmin){var importInput=el('input',{type:'file',accept:'.csv,text/csv','aria-label':'Import asset CSV',style:'max-width:190px'});importInput.addEventListener('change',function(){var file=importInput.files&&importInput.files[0];if(!file)return;if(file.size>400000)return say('CSV must be smaller than 400 KB.',true);var reader=new root.FileReader();reader.onload=function(){api('itsm-ci-import-csv',{csv:String(reader.result||'')}).then(function(r){if(!r.ok)return say(r.body.error||'Could not import assets.',true);say('Import complete: '+r.body.imported+' created, '+r.body.updated+' updated, '+r.body.failed+' skipped.');loadConfigurationItems();});};reader.onerror=function(){say('Could not read that CSV file.',true);};reader.readAsText(file);importInput.value='';});actions.appendChild(importInput);}
      var refreshLife=el('button',{type:'button',class:'btn l sm',onclick:loadConfigurationItems},'Refresh lifecycle');
      actions.appendChild(refreshLife);lifecycle.appendChild(actions);
      var tabBar=el('div',{class:'itsm-toolbar'});
      [['vendors','Vendors ('+ciVendors.length+')'],['contracts','Contracts ('+ciContracts.length+')'],['licenses','Software licenses ('+ciLicenses.length+')'],['warranty','Warranty alerts ('+ciWarranty.length+')'],['discovery','Automated discovery']].forEach(function(t){tabBar.appendChild(el('button',{type:'button',class:'btn l sm'+(ciLifecycleOpen===t[0]?' active':''),onclick:function(){ciLifecycleOpen=t[0];draw();}},t[1]));});
      lifecycle.appendChild(tabBar);
      var table=el('div',{class:'itsm-table-wrap'});
      function simpleTable(headers,values){var t=el('table',{class:'itsm-table'});t.appendChild(el('thead',{},el('tr',{},headers.map(function(x){return el('th',{},x);})))) ;var b=el('tbody');values.forEach(function(row){var tr=el('tr');row.forEach(function(v){tr.appendChild(el('td',{},v==null||v===''?'—':String(v)));});b.appendChild(tr);});t.appendChild(b);return t;}
      if(ciLifecycleOpen==='vendors'){
        table.appendChild(simpleTable(['Vendor','Support email','Website','Contracts','Licenses'],ciVendors.map(function(v){return [v.name,v.support_email,v.website,v.contract_count,v.license_count];})));
        if(isAdmin){var vn=el('input',{placeholder:'Vendor name','aria-label':'Vendor name',maxlength:'180'}),ve=el('input',{placeholder:'Support email','aria-label':'Vendor support email',type:'email'}),vw=el('input',{placeholder:'Website','aria-label':'Vendor website'});table.appendChild(el('div',{class:'bar'},vn,ve,vw,el('button',{type:'button',class:'btn sm',onclick:function(){if(!vn.value.trim())return say('Enter a vendor name.',true);api('itsm-ci-vendor-save',{name:vn.value,supportEmail:ve.value,website:vw.value}).then(function(r){if(!r.ok)return say(r.body.error,true);say('Vendor saved.');loadConfigurationItems();});}},'Add vendor')));}
      }else if(ciLifecycleOpen==='contracts'){
        table.appendChild(simpleTable(['Contract','Vendor','Type','Status','Start','End','Renewal'],ciContracts.map(function(x){return [x.name,x.vendor_name,cap(x.contract_type),cap(x.status),x.starts_on,x.ends_on,x.auto_renew?'Auto-renew':'Manual'];})));
        if(isAdmin){var cn=el('input',{placeholder:'Contract name','aria-label':'Contract name'}),cv=sel('Vendor','',[['','No vendor']].concat(ciVendors.map(function(v){return [String(v.id),v.name];})),function(){}),ct=el('input',{placeholder:'Contract number','aria-label':'Contract number'}),cs=el('input',{type:'date','aria-label':'Contract start date'}),ce=el('input',{type:'date','aria-label':'Contract end date'});table.appendChild(el('div',{class:'bar'},cn,cv,ct,cs,ce,el('button',{type:'button',class:'btn sm',onclick:function(){if(!cn.value.trim())return say('Enter a contract name.',true);api('itsm-ci-contract-save',{name:cn.value,vendorId:cv.value,contractNumber:ct.value,startsOn:cs.value,endsOn:ce.value}).then(function(r){if(!r.ok)return say(r.body.error,true);say('Contract saved.');loadConfigurationItems();});}},'Add contract')));}
      }else if(ciLifecycleOpen==='licenses'){
        table.appendChild(simpleTable(['Software','Publisher','Vendor','License type','Seats','Available','Status','Renewal / end'],ciLicenses.map(function(x){return [x.product_name,x.publisher,x.vendor_name,cap(x.license_type),x.seats_purchased,x.seats_available,cap(x.status),x.renewal_date||x.ends_on];})));
        if(isAdmin){var ln=el('input',{placeholder:'Software product','aria-label':'Software product'}),lv=sel('Vendor','',[['','No vendor']].concat(ciVendors.map(function(v){return [String(v.id),v.name];})),function(){}),lc=sel('Contract','',[['','No contract']].concat(ciContracts.map(function(v){return [String(v.id),v.name];})),function(){}),lp=el('input',{type:'number',min:'0',value:'1','aria-label':'Purchased seats'}),la=el('input',{type:'number',min:'0',value:'0','aria-label':'Assigned seats'}),le=el('input',{type:'date','aria-label':'License end date'});table.appendChild(el('div',{class:'bar'},ln,lv,lc,lp,la,le,el('button',{type:'button',class:'btn sm',onclick:function(){if(!ln.value.trim())return say('Enter a software product.',true);api('itsm-ci-license-save',{productName:ln.value,vendorId:lv.value,contractId:lc.value,seatsPurchased:lp.value,seatsAssigned:la.value,endsOn:le.value}).then(function(r){if(!r.ok)return say(r.body.error,true);say('Software license saved.');loadConfigurationItems();});}},'Add license')));}
      }else if(ciLifecycleOpen==='warranty'){
        table.appendChild(simpleTable(['Asset','Asset tag','Warranty expires','Days remaining','Criticality'],ciWarranty.map(function(x){return [x.name,x.asset_tag,x.warranty_expires_at,x.days_remaining,x.criticality];})));
        if(!ciWarranty.length)table.appendChild(el('p',{class:'m'},'No active assets have warranties expiring within the next 90 days.'));
      }else if(ciLifecycleOpen==='discovery'){
        var ds=ciDiscoveryStatus||{},connected=!!ds.configured;
        var agentCard=el('div',{class:'pcard'},el('div',{class:'bar'},el('div',{},el('h4',{},'EffDesk Windows discovery agent'),el('p',{class:'m'},'Free, subscription-independent inventory for Windows 10/11 and Windows Server.')) ,el('span',{class:'grow'}),el('span',{class:'itsm-severity low'},ciDiscoveryAgents.filter(function(a){return !a.revoked_at&&new Date(a.expires_at)>new Date();}).length+' active')));
        agentCard.appendChild(el('p',{class:'m'},'Install the lightweight PowerShell agent on each customer-managed Windows device. It reads hardware details and installed-app names/versions, then sends an encrypted-in-transit inventory snapshot to this workspace. It does not collect passwords, processes, browser data or logged-on user details.'));
        if(ciNewAgentToken){
          var scriptUrl=(root.location&&root.location.origin||'https://app.effdesk.com')+'/agents/windows/effdesk-discovery.ps1';
          agentCard.appendChild(el('div',{class:'pcard'},el('h4',{},'Agent token — shown once'),el('p',{class:'m'},'Copy this token now. EffDesk stores only its hash and cannot display it again. If it is lost, revoke this agent and create a replacement.'),el('textarea',{rows:'3',readonly:true,style:'width:100%;font-family:monospace'},ciNewAgentToken),el('p',{class:'m'},'Download the PowerShell script: ',el('a',{href:scriptUrl,download:'effdesk-discovery.ps1'},'effdesk-discovery.ps1')),el('p',{class:'m'},'Run this command in PowerShell on the target Windows device after downloading the script:'),el('textarea',{rows:'3',readonly:true,style:'width:100%;font-family:monospace'},ciNewAgentCommand),el('div',{class:'bar'},el('button',{type:'button',class:'btn sm',onclick:function(){var text=ciNewAgentToken+'\n'+ciNewAgentCommand;if(root.navigator&&root.navigator.clipboard&&root.navigator.clipboard.writeText)root.navigator.clipboard.writeText(text).then(function(){say('Token and command copied.');},function(){say('Select and copy the token and command manually.');});else say('Select and copy the token and command manually.');}},'Copy token + command'),el('button',{type:'button',class:'btn l sm',onclick:function(){ciNewAgentToken='';ciNewAgentCommand='';draw();}},'Close'))));
        }
        if(isAdmin)agentCard.appendChild(el('div',{class:'bar'},el('button',{type:'button',class:'btn sm',onclick:function(){
          var n=root.prompt('Name this Windows discovery agent (for example, Finance laptop 01):','Windows device');
          if(!n||!n.trim())return;
          api('itsm-ci-agent-create',{name:n.trim()}).then(function(r){
            if(!r.ok)return say(r.body.error||'Could not create discovery agent.',true);
            ciNewAgentToken=r.body.token;
             ciNewAgentCommand='powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\effdesk-discovery.ps1 -EnrollmentToken "'+ciNewAgentToken+'" -InstallScheduledTask -ApiUrl \"'+(root.location&&root.location.origin||'https://app.effdesk.com')+'/api/cmdb-agent\"';
             loadWindowsAgentRows();
          });
        }},'＋ Create Windows agent')));
        function loadWindowsAgentRows(){api('itsm-ci-agent-list').then(function(r){if(r.ok){ciDiscoveryAgents=r.body.agents||[];ciDiscoverySoftware=r.body.softwareItems||[];draw();}});}
        if(ciDiscoveryAgents.length){
          agentCard.appendChild(simpleTable(['Agent','Device','Operating system','Last seen','Software','Status'],ciDiscoveryAgents.map(function(a){return [a.name,a.hostname||'Not yet reported',a.os_version||'—',a.last_seen_at?ago(a.last_seen_at):'Never',a.software_count||0,a.revoked_at?'Revoked':new Date(a.expires_at)<new Date()?'Expired':a.last_sync_status==='success'?'Healthy':'Awaiting check-in'];})));
          if(isAdmin)ciDiscoveryAgents.forEach(function(a){if(!a.revoked_at&&new Date(a.expires_at)>new Date())agentCard.appendChild(el('div',{class:'bar'},el('span',{class:'m'},a.name+' · '+a.id.slice(0,8)),el('span',{class:'grow'}),el('button',{type:'button',class:'btn l sm',onclick:function(){if(!root.confirm('Revoke this Windows discovery agent? Its next check-in will be rejected.'))return;api('itsm-ci-agent-revoke',{id:a.id}).then(function(r){if(!r.ok)return say(r.body.error||'Could not revoke agent.',true);say('Discovery agent revoked.');loadWindowsAgentRows();});}},'Revoke')));});
        }else agentCard.appendChild(el('p',{class:'m'},'No Windows agents have been enrolled in this workspace yet.'));
        table.appendChild(agentCard);
        var softwareCount=ciDiscoveryAgents.reduce(function(n,a){return n+(Number(a.software_count)||0);},0);
        table.appendChild(el('p',{class:'m'},'Windows agents: '+ciDiscoveryAgents.length+' enrolled · '+softwareCount+' installed-software entries reported across the latest check-ins. Agent check-ins create/update hardware CIs and reconcile software inventory.'));
        if(ciDiscoverySoftware.length){table.appendChild(el('h4',{},'Discovered Windows software'));table.appendChild(simpleTable(['Application','Publisher','Version','Device','Last seen'],ciDiscoverySoftware.map(function(x){return [x.name,x.publisher,x.version,x.hostname||'—',x.last_seen_at?ago(x.last_seen_at):'—'];})));}

        table.appendChild(el('div',{class:'pcard'},el('div',{class:'bar'},el('div',{},el('h4',{},'Microsoft Intune discovery'),el('p',{class:'m'},connected?'Connected to Entra tenant '+ds.tenantId:'Connect your Microsoft Entra tenant to discover managed devices automatically.')),el('span',{class:'grow'}),el('span',{class:'itsm-severity '+(connected?'low':'medium')},connected?'Connected':'Not connected')),
          el('p',{class:'m'},'EffDesk reads managed-device inventory only. It does not change device settings, retire devices or write back to Microsoft.'),
          connected?el('div',{class:'bar'},el('span',{class:'m'},'Last sync: '+(ds.lastSyncAt?new Date(ds.lastSyncAt).toLocaleString():'Never')),el('span',{class:'m'},'Current: '+(ds.assets&&ds.assets.current||0)),el('span',{class:'m'},'Missing: '+(ds.assets&&ds.assets.missing||0)),isAdmin?el('button',{type:'button',class:'btn sm',onclick:function(){api('itsm-ci-discovery-sync').then(function(r){if(!r.ok)return say(r.body.error||'Discovery sync failed.',true);say('Intune sync complete: '+r.body.discovered+' devices found, '+r.body.created+' created and '+r.body.updated+' updated.');loadConfigurationItems();});}},'Sync now'):null,isAdmin?el('button',{type:'button',class:'btn l sm',onclick:function(){if(!root.confirm('Disconnect Microsoft Intune? Discovered assets will remain in the CMDB.'))return;api('itsm-ci-discovery-disconnect').then(function(r){if(!r.ok)return say(r.body.error||'Could not disconnect Intune.',true);say('Intune disconnected. Existing discovered assets were retained.');loadConfigurationItems();});}},'Disconnect'):null):
          (isAdmin?el('div',{class:'bar'},(function(){var tenant=el('input',{type:'text',placeholder:'Entra tenant ID or domain','aria-label':'Microsoft Entra tenant ID or domain',style:'min-width:280px'});var connect=el('button',{type:'button',class:'btn sm',onclick:function(){if(!tenant.value.trim())return say('Enter your Microsoft Entra tenant ID or verified domain.',true);api('itsm-ci-discovery-start',{tenantId:tenant.value.trim()}).then(function(r){if(!r.ok)return say(r.body.error||'Could not start Microsoft authorization.',true);root.location.assign(r.body.url);});}},'Connect Microsoft Intune');return el('div',{class:'bar'},tenant,connect);})()):el('p',{class:'m'},'Only workspace owners and admins can connect Microsoft Intune.')),
          ds.lastSyncError?el('p',{class:'itsm-severity high'},'Last sync error: '+ds.lastSyncError):null));
        if(ds.runs&&ds.runs.length)table.appendChild(simpleTable(['Started','Status','Devices','Created','Updated','Missing','Error'],ds.runs.map(function(x){return [x.started_at?new Date(x.started_at).toLocaleString():'—',cap(x.status),x.discovered,x.created,x.updated,x.marked_missing,x.error||''];})));
        if(!connected)table.appendChild(el('p',{class:'m'},'Requires an EffDesk Microsoft OAuth app and an Entra administrator to grant the requested delegated DeviceManagementManagedDevices.Read.All permission.'));
      }else table.appendChild(el('p',{class:'m'},'Choose a lifecycle area to review procurement records or upcoming warranty expirations.'));
      lifecycle.appendChild(table);
      return el('div',{class:'page wide itsm-page'},el('div',{class:'itsm-page-head'},el('div',{},el('span',{class:'itsm-kicker'},'IT OPERATIONS'),el('h2',{},'Assets & CMDB'),el('p',{class:'m'},'Track hardware and software assets, map technical dependencies and connect configuration items to service work.')),el('div',{class:'itsm-head-actions'},el('span',{class:'itsm-plan-pill'},'PRO'),el('button',{type:'button',class:'btn',onclick:function(){ciEditing={};ciDetail=null;ciSelected=0;draw();}},'＋ Add asset / CI'),el('button',{type:'button',class:'btn l',onclick:loadConfigurationItems},'Refresh'))),stats,lifecycle,el('div',{class:'itsm-layout'},el('div',{class:'itsm-main-col'},list),el('div',{class:'itsm-detail-col'},detail)));
    }
    function loadProblems() {
      closePanes(); problemsOpen=true; problemRows=null; problemDetail=null; problemSelected=0; problemCreating=false; problemLoading=true; draw();
      return api('itsm-problem-list',{limit:200,status:problemStatus}).then(function(r){
        problemLoading=false; if(!r.ok){problemRows=[];say(r.body.error||'Could not load problems.',true);}else problemRows=r.body.problems||[];draw();
      });
    }
    function openProblem(id) {
      problemSelected=Number(id)||0;problemCreating=false;problemDetail=null;draw();
      return api('itsm-problem-get',{id:problemSelected}).then(function(r){
        if(!r.ok){problemSelected=0;say(r.body.error||'Could not load problem.',true);return;}
        problemDetail=r.body;draw();
      });
    }
    function problemsPane() {
      var rows=problemRows||[], active=rows.filter(function(x){return ['open','investigating','known_error'].indexOf(x.status)>=0;}).length;
      var known=rows.filter(function(x){return x.known_error;}).length, p1=rows.filter(function(x){return x.priority==='P1';}).length;
      var stats=el('div',{class:'stats itsm-stats'},
        el('div',{class:'stat'},el('div',{class:'sv'},String(rows.length)),el('div',{class:'sl'},'Problems')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(active)),el('div',{class:'sl'},'Active')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(known)),el('div',{class:'sl'},'Known errors')),
        el('div',{class:'stat'},el('div',{class:'sv'},String(p1)),el('div',{class:'sl'},'P1 priority')));
      var statusFilter=el('select',{'aria-label':'Filter problems by status'});
      [['','All statuses'],['open','Open'],['investigating','Investigating'],['known_error','Known error'],['resolved','Resolved'],['closed','Closed']].forEach(function(x){var o=el('option',{value:x[0]},x[1]);o.selected=x[0]===problemStatus;statusFilter.appendChild(o);});
      statusFilter.addEventListener('change',function(){problemStatus=statusFilter.value;problemRows=null;problemLoading=true;draw();api('itsm-problem-list',{limit:200,status:problemStatus}).then(function(r){problemLoading=false;problemRows=r.ok?(r.body.problems||[]):[];if(!r.ok)say(r.body.error||'Could not load problems.',true);draw();});});
      var list=el('div',{class:'itsm-table-wrap'});
      if(problemLoading)list.appendChild(el('p',{class:'m'},'Loading problems…'));
      else if(!rows.length)list.appendChild(el('div',{class:'itsm-detail-empty'},el('h3',{},'No problem records yet'),el('p',{class:'m'},'Create a problem to investigate recurring or high-impact incidents and document a lasting fix.')));
      else {
        var tbl=el('table',{class:'itsm-table problem-table'});
        tbl.appendChild(el('thead',{},el('tr',{},['Priority','Problem','Status','Incidents','Owner','Updated'].map(function(x){return el('th',{},x);}))));
        var body=el('tbody');
        rows.forEach(function(p){
          var tr=el('tr',{class:problemSelected===Number(p.id)?'selected':'',tabindex:'0',role:'button','aria-label':'Open problem '+p.title});
          tr.appendChild(el('td',{},el('span',{class:'itsm-severity '+String(p.priority||'P3').toLowerCase()},p.priority||'P3')));
          tr.appendChild(el('td',{},el('strong',{},p.title),el('span',{class:'itsm-subline'},'#PRB-'+p.id+(p.known_error?' · Known error':''))));
          tr.appendChild(el('td',{},el('span',{class:'badge s-'+(p.status==='known_error'?'pending':p.status==='resolved'||p.status==='closed'?'solved':'open')},cap(p.status.replace('_',' ')))));
          tr.appendChild(el('td',{},String(p.incident_count||0)+(p.active_incident_count?' · '+p.active_incident_count+' active':'')));
          tr.appendChild(el('td',{},p.owner_name||p.owner_email||'Unassigned'));
          tr.appendChild(el('td',{},ago(p.updated_at)));
          var choose=function(){openProblem(p.id);};tr.addEventListener('click',choose);tr.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();choose();}});body.appendChild(tr);
        });
        tbl.appendChild(body);list.appendChild(tbl);
      }
      var listCard=el('section',{class:'pcard itsm-list-card'},
        el('div',{class:'itsm-card-head'},el('div',{},el('h3',{},'Problem register'),el('p',{class:'m'},'Find recurring incidents, understand root causes and track permanent fixes.')),
          el('div',{class:'itsm-toolbar'},statusFilter,el('button',{type:'button',class:'btn l sm',onclick:loadProblems},'Refresh'))),list);
      var detail=el('section',{class:'pcard itsm-detail-card problem-detail-card'});
      var p=problemDetail&&problemDetail.problem;
      if(!problemCreating&&!problemSelected)detail.appendChild(el('div',{class:'itsm-detail-empty'},el('span',{class:'itsm-empty-icon'},'⌁'),el('h3',{},'Problem investigation'),el('p',{class:'m'},'Select a problem or create a new record to document root cause, workaround, known errors and affected incidents.')));
      else if(problemSelected&&!p)detail.appendChild(el('p',{class:'m'},'Loading problem details…'));
      else {
        p=p||{title:'',description:'',status:'open',priority:'P3',known_error:false,root_cause:'',workaround:'',resolution:'',owner_id:''};
        var title=el('input',{type:'text',maxlength:'180',placeholder:'Problem title','aria-label':'Problem title',value:p.title||''});
        var description=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Describe the recurring issue, symptoms and scope…','aria-label':'Problem description'});description.value=p.description||'';
        var status=el('select',{'aria-label':'Problem status'});
        [['open','Open'],['investigating','Investigating'],['known_error','Known error'],['resolved','Resolved'],['closed','Closed']].forEach(function(x){status.appendChild(el('option',{value:x[0]},x[1]));});status.value=p.status||'open';
        var priority=el('select',{'aria-label':'Problem priority'});
        [['P1','P1 · Critical'],['P2','P2 · High'],['P3','P3 · Moderate'],['P4','P4 · Low']].forEach(function(x){priority.appendChild(el('option',{value:x[0]},x[1]));});priority.value=p.priority||'P3';
        var owner=el('select',{'aria-label':'Problem owner'});owner.appendChild(el('option',{value:''},'Unassigned'));
        agents.forEach(function(a){if(a.role!=='light')owner.appendChild(el('option',{value:a.id},a.name||a.email));});owner.value=p.owner_id||'';
        var known=el('input',{type:'checkbox','aria-label':'Mark as known error'});known.checked=!!p.known_error;
        var rootCause=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Document the underlying technical or process cause…','aria-label':'Root cause'});rootCause.value=p.root_cause||'';
        var workaround=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Document a safe temporary workaround…','aria-label':'Workaround'});workaround.value=p.workaround||'';
        var resolution=el('textarea',{rows:'3',maxlength:'5000',placeholder:'Document the permanent fix and verification…','aria-label':'Resolution'});resolution.value=p.resolution||'';
        var linked=el('input',{type:'text',placeholder:'Incident ticket numbers, separated by commas','aria-label':'Linked incident numbers',value:(problemDetail&&problemDetail.incidents||[]).map(function(x){return x.number;}).join(', ')});
        var save=el('button',{type:'button',class:'btn',onclick:function(){
          if(!title.value.trim())return say('Give the problem a title.',true);
          var numbers=linked.value.split(',').map(function(x){return Number(x.trim());}).filter(function(x){return Number.isSafeInteger(x)&&x>0;});
          api('itsm-problem-save',{id:problemSelected||undefined,title:title.value,description:description.value,status:status.value,priority:priority.value,knownError:known.checked,rootCause:rootCause.value,workaround:workaround.value,resolution:resolution.value,ownerId:owner.value,incidentNumbers:numbers}).then(function(r){
            if(!r.ok)return say(r.body.error||'Could not save problem.',true);
            problemSelected=Number(r.body.problem.id);problemCreating=false;problemDetail=r.body;
            return api('itsm-problem-list',{limit:200,status:problemStatus}).then(function(l){if(l.ok)problemRows=l.body.problems||[];draw();say('Problem saved.');});
          });
        }},problemCreating?'Create problem':'Save problem');
        detail.appendChild(el('div',{class:'itsm-detail-head'},el('div',{},el('span',{class:'itsm-kicker'},problemCreating?'NEW PROBLEM':'PROBLEM #PRB-'+p.id),el('h3',{},problemCreating?'New problem':p.title||'Problem'),el('p',{class:'m'},problemCreating?'Capture the issue once and associate all related incidents.':'Created '+ago(p.created_at)+' · Updated '+ago(p.updated_at))),el('div',{class:'itsm-detail-actions'},problemSelected?el('button',{type:'button',class:'btn l sm',onclick:function(){problemCreating=false;openProblem(problemSelected);}},'Reload'):null)));
        detail.appendChild(el('div',{class:'problem-form-grid'},el('label',{},el('span',{},'Title'),title),el('label',{},el('span',{},'Status'),status),el('label',{},el('span',{},'Priority'),priority),el('label',{},el('span',{},'Problem owner'),owner)));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Description'),description));
        detail.appendChild(el('label',{class:'problem-known-error'},known,el('span',{},el('strong',{},'Known error'),el('small',{},'The root cause is understood or a documented workaround exists.'))));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Root-cause analysis'),rootCause));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Workaround'),workaround));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Permanent resolution'),resolution));
        detail.appendChild(el('div',{class:'problem-form-section'},el('h4',{},'Related incidents'),el('p',{class:'m'},'Link incident ticket numbers from this workspace. Only incident tickets can be linked.'),linked));
        detail.appendChild(el('div',{class:'itsm-save-row'},save));
        if(problemSelected&&problemDetail&&problemDetail.events&&problemDetail.events.length){
          var history=el('div',{class:'problem-history'},el('h4',{},'Problem activity'));
          problemDetail.events.forEach(function(e){history.appendChild(el('div',{class:'problem-history-item'},el('strong',{},e.actor_name||'System'),el('span',{class:'m'},e.detail),el('small',{},ago(e.created_at))));});detail.appendChild(history);
        }
      }
      return el('div',{class:'page wide itsm-page problems-page'},el('div',{class:'itsm-page-head'},el('div',{},el('span',{class:'itsm-kicker'},'SERVICE MANAGEMENT'),el('h2',{},'Problem management'),el('p',{class:'m'},'Move beyond recurring incidents with documented root causes, workarounds and permanent fixes.')),el('div',{class:'itsm-head-actions'},el('span',{class:'itsm-plan-pill'},'PRO'),el('button',{type:'button',class:'btn',onclick:function(){closePanes();problemsOpen=true;problemCreating=true;problemDetail=null;problemSelected=0;draw();}},'＋ New problem'))),stats,el('div',{class:'itsm-layout'},el('div',{class:'itsm-main-col'},listCard),el('div',{class:'itsm-detail-col'},detail)));
    }

    function goHome() { addr(0); closePanes(); home = true; return api('dashboard').then(function (r) { dash = r.ok ? r.body : null; if (!r.ok) say(r.body.error || 'That did not work.', true); else draw(); }); }
    function search() { filter.q = qBox.value.trim(); closePanes(); refresh(); }
    qBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    newBtn.addEventListener('click', function () { closePanes(); creating = true; newf = blankNew(); pending = []; draw(); });


    // ── who else is looking at this ticket ──
    function othersText() { if (!others.length) return ''; var names = others.map(function (o) { return o.name || 'Someone'; }), typing = others.some(function (o) { return o.typing; }); return (names.length > 2 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more' : names.join(' and ')) + (typing ? (names.length > 1 ? ' are replying' : ' is replying') : (names.length > 1 ? ' are also here' : ' is also viewing this ticket')); }
    function paintOthers() { var b = main.querySelector('.collide'); if (!b) return; b.textContent = othersText(); b.hidden = !others.length; b.classList.toggle('typing', others.some(function (o) { return o.typing; })); }
    function presenceTick() {
      if (!current || (doc.visibilityState && doc.visibilityState === 'hidden')) return;
      var ta = main.querySelector('.compose textarea'), rich = main.querySelector('.compose .ae-area'), n = current.ticket.number;
      api('presence', { number: n, typing: !!((rich && rich.textContent.trim()) || (ta && ta.value.trim())) }).then(function (r) { if (!r.ok || !current || current.ticket.number !== n) return; var o = r.body.others || [], sig = JSON.stringify(o); if (sig !== othersSig) { othersSig = sig; others = o; paintOthers(); } });
    }
    root.setInterval(presenceTick, 20000);

    // ── a preview of matching tickets under the search box ──
    var qWrap = el('span', { class: 'qwrap' }), qPop = el('div', { class: 'qpop', id: 'qpop', role: 'listbox', 'aria-label': 'Matching tickets' });
    qPop.hidden = true; qBox.parentNode.insertBefore(qWrap, qBox); qWrap.appendChild(qBox); qWrap.appendChild(qPop);
    qBox.setAttribute('role', 'combobox'); qBox.setAttribute('aria-expanded', 'false'); qBox.setAttribute('aria-controls', 'qpop'); qBox.setAttribute('aria-autocomplete', 'list');
    function qClose() { qPop.hidden = true; qItems = []; qSel = -1; qBox.setAttribute('aria-expanded', 'false'); qBox.removeAttribute('aria-activedescendant'); }
    function qPick(i) {
      var item=qItems[i];if(!item)return;qClose();qBox.value='';qBox.blur();
      if(item.kind==='ticket')return open(item.number);
      closePanes();home=false;current=null;creating=false;settings=null;articles=null;report=null;profile=false;
      if(item.kind==='contact')return openContact(item.email);
      if(item.kind==='company'){manage='clients';mEdit={id:item.id,name:item.name,domain:item.domain||'',notes:item.notes||'',shareTickets:item.share_tickets===true};mDetail=true;draw();return;}
      if(item.kind==='agent'){manage='team';agentOpen=item.id;mDetail=true;team=null;draw();return;}
    }
    function qDraw() {
      while(qPop.firstChild)qPop.removeChild(qPop.firstChild);
      if(!qItems.length)qPop.appendChild(el('div',{class:'qnone m'},'No matching tickets, agents, contacts or companies.'));
      var groups=[['ticket','Tickets'],['contact','Contacts'],['company','Companies'],['agent','Agents']];
      groups.forEach(function(g){
        var matches=qItems.map(function(x,i){return {item:x,index:i};}).filter(function(x){return x.item.kind===g[0];});
        if(!matches.length)return;
        qPop.appendChild(el('div',{class:'qgroup-label'},g[1]));
        matches.forEach(function(x){
          var a=x.item,title='',meta='';
          if(a.kind==='ticket'){title='#'+a.number+' '+a.subject;meta=(a.requester_name?a.requester_name+' · ':'')+a.requester_email;}
          else if(a.kind==='contact'){title=a.name||a.email;meta=a.email+(a.company_name?' · '+a.company_name:'');}
          else if(a.kind==='company'){title=a.name;meta=a.domain?'@'+a.domain:'Company';}
          else{title=a.name||a.email;meta=a.email+' · '+a.role;}
          qPop.appendChild(el('button',{type:'button',class:'qi qresult',role:'option',id:'qi'+x.index,'aria-selected':String(x.index===qSel),onmousedown:function(e){e.preventDefault();qPick(x.index);}},el('span',{class:'qresult-icon'},a.kind==='ticket'?'#':a.kind==='contact'?'◉':a.kind==='company'?'▦':'♙'),el('span',{class:'qresult-copy'},el('strong',{},title),el('span',{class:'m'},meta)),a.kind==='ticket'?el('span',{class:'badge s-'+a.status},cap(a.status)):null));
        });
      });
      if(qItems.length)qPop.appendChild(el('div',{class:'qfoot m'},'Select a result · Enter to search tickets · ↑ ↓ to choose'));
      qPop.hidden=false;qBox.setAttribute('aria-expanded','true');
      if(qSel>=0)qBox.setAttribute('aria-activedescendant','qi'+qSel);else qBox.removeAttribute('aria-activedescendant');
    }
    var qTimer = 0;
    qBox.addEventListener('input', function () {
      root.clearTimeout(qTimer); var v = qBox.value.trim(); if (v.length < 2) { qSeq++; return qClose(); }
      qTimer = root.setTimeout(function () { var my = ++qSeq; api('global-search', { q: v }).then(function (r) { if (my !== qSeq || !r.ok) return; var b=r.body;qItems=(b.tickets||[]).map(function(x){return Object.assign({kind:'ticket'},x);}).concat((b.contacts||[]).map(function(x){return Object.assign({kind:'contact'},x);}), (b.companies||[]).map(function(x){return Object.assign({kind:'company'},x);}), (b.agents||[]).map(function(x){return Object.assign({kind:'agent'},x);}));qSel=-1;qDraw(); }); }, 200);
    });
    qBox.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (qPop.hidden || !qItems.length) return; e.preventDefault(); qSel = (qSel + (e.key === 'ArrowDown' ? 1 : -1) + qItems.length + 1) % (qItems.length + 1); if (qSel === qItems.length) qSel = -1; qDraw(); }
      else if (e.key === 'Enter' && qSel >= 0 && !qPop.hidden) { e.preventDefault(); e.stopImmediatePropagation(); qPick(qSel); }
      else if (e.key === 'Escape') { qClose(); }
    }, true);
    qBox.addEventListener('blur', function () { root.setTimeout(qClose, 120); });
    qBox.addEventListener('focus', function () { if (qBox.value.trim().length >= 2 && qItems.length) qDraw(); });

    // ── keyboard shortcuts ──
    var SHORTCUTS = [['/', 'Search tickets'], ['c', 'New ticket'], ['j / k', 'Next / previous ticket in the list'], ['o', 'Open the highlighted ticket'], ['r', 'Reply to the customer'], ['m', 'Write an internal note'], ['g then h', 'Go to Home'], ['g then v', 'Go to All Tickets'], ['Ctrl or ⌘ + Enter', 'Send what you wrote'], ['?', 'Show this list'], ['Esc', 'Close this list or leave the search']];
    var helpEl = null;
    // while a message is on its way the send buttons and the text box are locked, so it cannot go out twice
    function paintSending() { Array.prototype.forEach.call(root.document.querySelectorAll('[data-reply],[data-note],.compose textarea,.split select'), function (n) { if (sending) { n.setAttribute('disabled', 'disabled'); } else { n.removeAttribute('disabled'); } }); var b = root.document.querySelector('[data-reply]'); if (b) { if (sending) { b.setAttribute('data-label', b.textContent); b.textContent = 'Sending…'; } else if (b.getAttribute('data-label')) { b.textContent = b.getAttribute('data-label'); b.removeAttribute('data-label'); } } }
    function closeHelp() { helpOpen = false; if (helpEl && helpEl.parentNode) helpEl.parentNode.removeChild(helpEl); helpEl = null; }
    function showHelp() {
      if (helpOpen) return; helpOpen = true;
      helpEl = el('div', { class: 'khelp-bg', 'data-khelp': '1', onclick: function (e) { if (e.target === helpEl) closeHelp(); } }, el('div', { class: 'khelp', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Keyboard shortcuts' }, el('h2', {}, 'Keyboard shortcuts'),
        el('table', {}, el('tbody', {}, SHORTCUTS.map(function (x) { return el('tr', {}, el('th', { scope: 'row' }, x[0].split(' then ').reduce(function (acc, k, i) { if (i) acc.push(' then '); acc.push(el('kbd', {}, k)); return acc; }, [])), el('td', {}, x[1])); }))),
        el('button', { type: 'button', class: 'btn', 'data-help-close': '1', onclick: closeHelp }, 'Close')));
      doc.body.appendChild(helpEl);
      var cb = helpEl.querySelector('[data-help-close]'); if (cb && cb.focus) cb.focus();
    }
    function kbRows() { return [].slice.call(main.querySelectorAll('tbody tr[tabindex], .tlist tr[tabindex], [data-ticket-row]')); }
    function kbMove(d) { var rows = kbRows(); if (!rows.length) return; kbIndex = Math.max(0, Math.min(rows.length - 1, (kbIndex < 0 ? (d > 0 ? 0 : 0) : kbIndex + d))); rows.forEach(function (r, i) { r.classList.toggle('kb-on', i === kbIndex); }); var r = rows[kbIndex]; if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }
    function focusCompose(m) { if (!current) return; if (mode !== m) { var ta0 = main.querySelector('.compose textarea'); if (ta0) draft = ta0.value; mode = m; draw(); } var a = main.querySelector('.compose .ed-area') || main.querySelector('.compose textarea'); if (a && a.focus) a.focus(); }
    doc.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && helpOpen) { closeHelp(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target; if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (helpOpen) return;
      var k = e.key;
      if (pendingG) { pendingG = false; if (k === 'h') { e.preventDefault(); goHome(); } else if (k === 'v') { e.preventDefault(); goViews(); } return; }
      if (k === '?') { e.preventDefault(); showHelp(); }
      else if (k === '/') { e.preventDefault(); qBox.focus(); }
      else if (k === 'c') { e.preventDefault(); newBtn.click(); }
      else if (k === 'g') { pendingG = true; root.setTimeout(function () { pendingG = false; }, 1200); }
      else if (k === 'j') { e.preventDefault(); kbMove(1); }
      else if (k === 'k') { e.preventDefault(); kbMove(-1); }
      else if (k === 'o' || (k === 'Enter' && kbIndex >= 0 && !current)) { var rows = kbRows(); if (!current && rows[kbIndex]) { e.preventDefault(); rows[kbIndex].click(); } }
      else if (k === 'r') { e.preventDefault(); focusCompose('reply'); }
      else if (k === 'm') { e.preventDefault(); focusCompose('note'); }
    });

    // ── the profile menu ──
    function setMenu(on) { menuOpen = on; userBtn.setAttribute('aria-expanded', String(on)); drawMenu(); }
    function drawMenu() {
      while (userMenu.firstChild) userMenu.removeChild(userMenu.firstChild);
      userMenu.hidden = !menuOpen; if (!menuOpen) return;
      userMenu.appendChild(el('div', { class: 'who-line' }, el('strong', {}, meName), el('div', { class: 'm' }, me)));
      userMenu.appendChild(el('button', { type: 'button', role: 'menuitem', 'data-profile': '1', onclick: function () { setMenu(false); closePanes(); profile = true; draw(); } }, 'Profile and themes'));
      userMenu.appendChild(el('button', { type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(myAvail), 'data-availability': '1', onclick: function () { var v = !myAvail; api('availability-set', { available: v }).then(function (r) { if (!r.ok) return say(r.body.error, true); myAvail = v; drawMenu(); say(v ? 'You will get new tickets again.' : 'You are away: new tickets will go to others.'); }); } }, myAvail ? '● Available for new tickets' : '○ Away (no new tickets)'));
      userMenu.appendChild(el('button', { type: 'button', role: 'menuitem', 'data-shortcuts': '1', onclick: function () { setMenu(false); showHelp(); } }, 'Keyboard shortcuts'));
      var lang = el('label', { class: 'effdesk-language-menu' }, el('span', {}, 'Language'), sel('Language', locale, [['en','English'],['es','Español']], function (v) { locale = v; if (root.EffI18n) root.EffI18n.setLocale(v); persistTicketPrefs(); draw(); }));
      userMenu.appendChild(lang);
      userMenu.appendChild(el('a', { role: 'menuitem', href: '/app.html', 'data-account': '1' }, 'Account and billing'));
      userMenu.appendChild(el('button', { type: 'button', role: 'menuitem', 'data-signout': '1', onclick: function () { post('/api/auth/sign-out', {}).then(function () { nav.go('/'); }); } }, 'Sign out'));
    }
    userBtn.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!menuOpen); });
    doc.addEventListener('click', function (e) { if (menuOpen && !userMenu.contains(e.target)) setMenu(false); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) { setMenu(false); userBtn.focus(); } });

    // ── chrome: the rail and the tabs ──
    function drawChrome() {
      var where = ciOpen ? 'assets' : changesOpen ? 'changes' : problemsOpen ? 'problems' : incidentsOpen ? 'itsm' : approvalInbox ? 'approvals' : home ? 'home' : articles ? 'help' : settings ? 'mail' : manage ? 'manage' : report ? 'reports' : 'tickets';
      var item = function (name, label, data, onclick) { var b = el('button', { type: 'button', class: 'ri', 'aria-label': label, title: label, 'aria-current': String(where === name) }, icon(name)); b.setAttribute(data, '1'); b.addEventListener('click', onclick); return b; };
      while (rail.firstChild) rail.removeChild(rail.firstChild);
      rail.appendChild(el('a', { class: 'logo', href: '/desk.html' + (orgId ? '?org=' + encodeURIComponent(orgId) : ''), 'data-home': '1', 'aria-label': 'Dashboard', title: 'Dashboard', onclick: function (e) { e.preventDefault(); goHome(); } }, el('img', { src: '/brand/mark.svg', alt: '', width: 34, height: 34 })));
      rail.appendChild(item('home', 'Dashboard', 'data-dash', goHome));
      rail.appendChild(item('tickets', 'All Tickets', 'data-nav', goViews));
      if (has('request_forms')) rail.appendChild(item('approvals', 'Approvals', 'data-approvals', loadApprovals));
      if (has('itsm') && role !== 'light') { rail.appendChild(item('itsm', 'Incident management', 'data-itsm', loadItsm)); rail.appendChild(item('problems', 'Problem management', 'data-problems', loadProblems)); rail.appendChild(item('changes', 'Change management', 'data-changes', loadChanges)); rail.appendChild(item('assets', 'Assets and CMDB', 'data-assets', loadConfigurationItems)); }
      if (has('clients')) rail.appendChild(item('contacts', 'Contacts and companies', 'data-contacts', function () { closePanes();home=false;current=null;creating=false;manage='contacts';contactProfile=null;contactRows=null;mDetail=true;draw();loadContacts(); }));
      if (isAdmin || support) rail.appendChild(item('manage', 'Manage the workspace', 'data-manage', function () { closePanes(); manage = 'team'; mEdit = null; draw(); }));
      if (isAdmin) rail.appendChild(el('a', { class: 'ri', href: 'https://app.effdesk.com/integrations.html' + (orgId ? '?org=' + encodeURIComponent(orgId) : ''), 'aria-label': 'External project integrations', title: 'External project integrations' }, icon('integrations')));
      rail.appendChild(item('reports', 'Reports', 'data-reports', loadReport));
      if (isAdmin || support) rail.appendChild(item('mail', 'Email settings', 'data-mail', function () { api('mail-get').then(function (r) { if (!r.ok) return say(r.body.error, true); closePanes(); settings = r.body; draw(); }); }));
      rail.appendChild(item('help', 'Help center', 'data-help', loadArticles));
      rail.appendChild(el('span', { class: 'grow' }));
      rail.appendChild(el('a', { class: 'ri', href: '/app.html', 'aria-label': 'Account', title: 'Account and billing' }, icon('account')));
      while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);
      var onViews = !home && !approvalInbox && !current && !creating && !settings && !articles && !manage && !profile && !report;
      tabsEl.appendChild(el('button', { type: 'button', role: 'tab', class: 'tab', 'data-home-tab': '1', 'aria-selected': String(home), onclick: goHome }, 'Home'));
      tabsEl.appendChild(el('button', { type: 'button', role: 'tab', class: 'tab', 'data-views': '1', 'aria-selected': String(onViews), onclick: goViews }, 'All Tickets'));
      openTabs.forEach(function (t) {
        var on = !!current && current.ticket.number === t.number;
        tabsEl.appendChild(el('span', { class: 'tab has-x', 'aria-selected': String(on) },
          el('button', { type: 'button', role: 'tab', 'data-tab': String(t.number), 'aria-selected': String(on), onclick: function () { open(t.number); } }, '#' + t.number + ' ' + t.subject),
          el('button', { type: 'button', class: 'x', 'data-close': String(t.number), 'aria-label': 'Close #' + t.number, onclick: function () { openTabs = openTabs.filter(function (x) { return x.number !== t.number; }); if (current && current.ticket.number === t.number) current = null; draw(); } }, '×')));
      });
      while (orgSlot.firstChild) orgSlot.removeChild(orgSlot.firstChild);
      if (orgs.length > 1) orgSlot.appendChild(sel('Organization', orgId, orgs.map(function (o) { return [o.id, o.name]; }), function (v) { orgId = v; closePanes(); openTabs = []; ticketTasks = {}; ticketApprovals = {}; approvalRows = null; loadInit().then(refresh); }));
    }

    // ── Views: filters, queues, saved views and the ticket table ──
    function applyFilter(f, columns) { filter = Object.assign({ status: '', assignee: '', q: '', columnFilters: {} }, f); qBox.value = filter.q || ''; if (Array.isArray(columns) && columns.length) ticketColumns = columns.slice(); refresh(); }
    function viewsPane() {
      var n = function (s) { return s === 'active' ? (counts.open || 0) + (counts.pending || 0) + (counts.on_hold || 0) : counts[s]; };
      var flt = function (label, pressed, onclick, count, data) { var b = el('button', { type: 'button', class: 'flt', 'aria-pressed': String(pressed), onclick: onclick }, el('span', {}, label), count != null && count !== '' ? el('span', { class: 'n' }, String(count)) : null); if (data) b.setAttribute(data[0], data[1]); return b; };
      var statusBtns = STATUS.map(function (s) { return flt(s === 'active' ? 'Active' : cap(s), filter.status === s && !filter.queue && !filter.following, function () { filter = { status: s, assignee: filter.assignee || '', q: filter.q || '' }; refresh(); }, n(s), ['data-status', s]); });
      statusBtns.push(flt('Assigned to me', filter.assignee === 'me', function () { filter.assignee = filter.assignee === 'me' ? '' : 'me'; refresh(); }, null, ['data-mine', '1']));
      statusBtns.push(flt('Following', filter.following === 'me', function () { filter = { status: '', assignee: '', q: '', following: filter.following === 'me' ? '' : 'me' }; refresh(); }, null, ['data-following', '1']));
      if (has('sla')) { statusBtns.push(flt('SLA at risk', filter.sla === 'risk', function () { filter = { status: '', assignee: '', q: '', sla: filter.sla === 'risk' ? '' : 'risk' }; refresh(); }, null, ['data-sla-filter', 'risk'])); statusBtns.push(flt('SLA breached', filter.sla === 'breached', function () { filter = { status: '', assignee: '', q: '', sla: filter.sla === 'breached' ? '' : 'breached' }; refresh(); }, null, ['data-sla-filter', 'breached'])); }
      var side = el('div', { class: 'side' }, el('h3', {}, 'Tickets'), el('div', { role: 'group', 'aria-label': 'Status' }, statusBtns));
      side.appendChild(el('h3', {}, 'Queues'));
      if (!has('queues')) side.appendChild(lock('queues'));
      else if (!queues.length) side.appendChild(el('p', { class: 'm' }, isAdmin ? 'No queues yet. Add some under Manage.' : 'No queues yet.'));
      else { side.appendChild(flt('No queue', filter.queue === 'none', function () { filter = { status: filter.status || '', assignee: '', q: '', queue: filter.queue === 'none' ? '' : 'none' }; refresh(); }, null, ['data-queue', 'none'])); queues.forEach(function (q) { side.appendChild(flt(q.name, String(filter.queue) === String(q.id), function () { filter = { status: filter.status || '', assignee: '', q: '', queue: String(filter.queue) === String(q.id) ? '' : String(q.id) }; refresh(); }, q.active, ['data-queue', String(q.id)])); }); }
      side.appendChild(el('h3', {}, 'Saved views'));
      if (!has('saved_views')) side.appendChild(lock('saved_views'));
      else {
        views.forEach(function (v) { side.appendChild(el('div', { class: 'vrow' }, flt(v.name + (v.shared ? ' (team)' : ''), false, function () { applyFilter(v.filter, v.columns); }, null, ['data-view', String(v.id)]), el('button', { type: 'button', class: 'view-refresh', 'aria-label': 'Refresh the ' + v.name + ' view', 'data-view-refresh': String(v.id), title: 'Refresh this view', onclick: function (e) { e.stopPropagation(); applyFilter(v.filter); say('Refreshing ' + v.name + '…'); } }, '↻'), v.mine || isAdmin ? el('button', { type: 'button', class: 'x', 'aria-label': 'Delete the view ' + v.name, 'data-view-delete': String(v.id), onclick: function () { api('view-delete', { id: v.id }).then(function (r) { if (!r.ok) return noteFrom(r); return loadInit().then(draw); }); } }, '×') : null)); });
        if (savingView) {
          var nm = el('input', { 'aria-label': 'View name', placeholder: 'Name this view', maxlength: '60' }), sh = el('input', { type: 'checkbox', 'aria-label': 'Share with the team' });
          side.appendChild(el('div', { class: 'saveview' }, nm, el('button', { type: 'button', class: 'btn sm', 'data-view-save': '1', onclick: function () { api('view-save', { name: nm.value, shared: sh.checked, filter: filter, columns: ticketColumns }).then(function (r) { if (!r.ok) return noteFrom(r); savingView = false; return loadInit().then(draw); }); } }, 'Save')));
          if (isAdmin) side.appendChild(el('label', { class: 'm' }, sh, ' Share with the team'));
        } else side.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-view-new': '1', style: 'margin-top:8px', onclick: function () { savingView = true; draw(); } }, 'Save current filters and columns as a view'));
      }
      var name = function (id) { var a = agents.filter(function (x) { return x.id === id; })[0]; return a ? (a.name || a.email) : ''; };
      var pickBox = function (n) { var cb = el('input', { type: 'checkbox', 'aria-label': 'Select #' + n, 'data-pick': String(n) }); cb.checked = !!picked[n]; cb.addEventListener('click', function (e) { e.stopPropagation(); }); cb.addEventListener('change', function () { if (cb.checked) picked[n] = true; else delete picked[n]; draw(); }); return cb; };
      var nPicked = Object.keys(picked).length, bulk = function (patch, label) { return api('bulk', { numbers: Object.keys(picked).map(Number), patch: patch }).then(function (r) { if (!r.ok) return say(r.body.error, true); picked = {}; return refresh().then(function () { say(label + ': ' + r.body.done + ' ticket(s) updated' + (r.body.failed ? ', ' + r.body.failed + ' could not be changed (' + r.body.error + ')' : '') + '.', !!r.body.failed); }); }); };
      var bulkBar = nPicked ? el('div', { class: 'bar bulk', role: 'group', 'aria-label': 'Bulk actions', 'data-bulk': '1' }, el('div', { class: 'bulk-summary' }, el('span', { class: 'bulk-count' }, String(nPicked)), el('span', {}, nPicked === 1 ? 'ticket selected' : 'tickets selected')),
        el('span', { class: 'bulk-divider', 'aria-hidden': 'true' }),
        el('label', { class: 'bulk-control' }, el('span', {}, 'Status'), sel('Set status for the selected tickets', '', [['', 'Choose status…']].concat(statusOpts()), function (v) { if (v) bulk(statusPatch(v), 'Status'); })),
        el('label', { class: 'bulk-control' }, el('span', {}, 'Priority'), sel('Set priority for the selected tickets', '', [['', 'Choose priority…'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], function (v) { if (v) bulk({ priority: v }, 'Priority'); })),
        el('label', { class: 'bulk-control' }, el('span', {}, 'Assignee'), sel('Assign the selected tickets', '', [['', 'Choose assignee…'], ['none', 'Nobody']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { if (v) bulk({ assigneeId: v === 'none' ? null : v }, 'Assignee'); })),
        el('button', { type: 'button', class: 'bulk-clear', onclick: function () { picked = {}; draw(); } }, 'Clear selection')) : null;
      var columnDefs = {
        status: { label: 'Status', cls: 'c-status', cell: function (t) { return el('span', { class: 'badge s-' + t.status, title: t.custom_status_id ? 'Counts as ' + t.status : null }, statusName(t)); } },
        number: { label: 'Ticket', cls: 'num', cell: function (t) { return '#' + t.number; } },
        subject: { label: 'Subject', cls: 'subj', cell: function (t) { var tags = (t.tags || []).map(function (g) { return el('button', { type: 'button', class: 'tag', 'data-tag': g, onclick: function (e) { e.stopPropagation(); filter = { status: '', assignee: '', q: '', tag: g }; refresh(); } }, g); }); return [t.subject, tags.length ? el('span', { class: 'tagline' }, tags) : null]; } },
        requester: { label: 'Requester', cls: 'c-req', cell: function (t) { return t.requester_name || t.requester_email; } },
        priority: { label: 'Priority', cls: 'c-pri', cell: function (t) { return cap(t.priority); } },
        assignee: { label: 'Assignee', cls: 'c-asg', cell: function (t) { return name(t.assignee_id) || '—'; } },
        sla: { label: 'SLA', cls: 'c-sla', cell: function (t) { return t.sla && t.sla.worst !== 'ok' && t.sla.worst !== 'met' ? el('span', { class: 'sla s-' + t.sla.worst, 'data-sla-row': t.sla.worst }, t.sla.worst === 'breached' ? 'Breached' : t.sla.worst === 'missed' ? 'Missed' : 'At risk') : '—'; } },
        updated: { label: 'Updated', cls: 'when', cell: function (t) { return ago(t.updated_at); } }
      };
      var setColumnFilter = function (key, value) {
        filter.columnFilters = filter.columnFilters || {};
        if (value) filter.columnFilters[key] = value; else delete filter.columnFilters[key];
        root.clearTimeout(columnFilterTimer);
        columnFilterTimer = root.setTimeout(refresh, 300);
      };
      var textColumnFilter = function (key, placeholder, type) {
        var input = el('input', { class: 'column-filter-input', type: type || 'search', 'aria-label': 'Filter ' + key, placeholder: placeholder, value: (filter.columnFilters || {})[key] || '' });
        input.addEventListener('change', function () { setColumnFilter(key, input.value.trim()); });
        input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); setColumnFilter(key, input.value.trim()); input.blur(); } });
        return input;
      };
      var updatedDateFilter = function (cf) {
        var from = cf.updatedFrom || '', to = cf.updatedTo || '';
        var label = !from && !to ? 'Any date' : from && to ? (from === to ? from : from + ' – ' + to) : from ? 'From ' + from : 'Through ' + to;
        var trigger = el('button', { type: 'button', class: 'updated-date-trigger', 'aria-label': 'Choose updated date or date range', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' },
          el('span', { class: 'calendar-glyph', 'aria-hidden': 'true' }, '▦'), el('span', {}, label), el('span', { class: 'calendar-chevron', 'aria-hidden': 'true' }, '▾'));
        var popup = null, month = new Date(); month.setDate(1);
        var formatDate = function (d) { return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); };
        var close = function () {
          if (popup && popup.parentNode) popup.parentNode.removeChild(popup);
          popup = null; trigger.setAttribute('aria-expanded','false');
          doc.removeEventListener('pointerdown', outside, true);
        };
        var outside = function (e) { if (popup && !popup.contains(e.target) && !trigger.contains(e.target)) close(); };
        var render = function () {
          popup.replaceChildren();
          var head = el('div', { class: 'updated-calendar-head' },
            el('button', { type: 'button', class: 'updated-calendar-nav', 'aria-label': 'Previous month', onclick: function () { month.setMonth(month.getMonth()-1); render(); } }, '‹'),
            el('strong', {}, 'Select updated date'),
            el('button', { type: 'button', class: 'updated-calendar-nav', 'aria-label': 'Next month', onclick: function () { month.setMonth(month.getMonth()+1); render(); } }, '›'));
          popup.appendChild(head);
          var mode = popup.dataset.mode || 'range';
          var modes = el('div', { class: 'updated-calendar-modes' });
          modes.appendChild(el('button', { type: 'button', class: 'updated-calendar-mode' + (mode==='range'?' active':''), onclick: function () { popup.dataset.mode='range'; render(); } }, 'Date range'));
          modes.appendChild(el('button', { type: 'button', class: 'updated-calendar-mode' + (mode==='single'?' active':''), onclick: function () { popup.dataset.mode='single'; render(); } }, 'Single date'));
          popup.appendChild(modes);
          var months = el('div', { class: 'updated-calendar-months' });
          [0,1].forEach(function (offset) {
            var first = new Date(month.getFullYear(), month.getMonth()+offset, 1);
            var panel = el('div', { class: 'updated-calendar-month' });
            panel.appendChild(el('div', { class: 'updated-calendar-month-title' }, first.toLocaleDateString(undefined,{month:'long',year:'numeric'})));
            var grid = el('div', { class: 'updated-calendar-grid' });
            ['Su','Mo','Tu','We','Th','Fr','Sa'].forEach(function (dayName) { grid.appendChild(el('span',{class:'updated-calendar-weekday'},dayName)); });
            var offsetDay = first.getDay(), days = new Date(first.getFullYear(),first.getMonth()+1,0).getDate();
            for (var blank=0; blank<offsetDay; blank++) grid.appendChild(el('span',{class:'updated-calendar-empty'}));
            for (var day=1; day<=days; day++) {
              var value = formatDate(new Date(first.getFullYear(),first.getMonth(),day));
              var isEndpoint = value===from || value===to;
              var inRange = from && to && value>=from && value<=to;
              var cls = 'updated-calendar-day' + (inRange?' selected':'') + (isEndpoint?' endpoint':'');
              var button = el('button',{type:'button',class:cls,'aria-pressed':String(!!inRange),'aria-label':value},String(day));
              button.addEventListener('click',function(v){return function(){
                if (popup.dataset.mode==='single') { from=v; to=v; }
                else if (!from || (from && to)) { from=v; to=''; }
                else if (v<from) { to=from; from=v; }
                else { to=v; }
                close();
                setColumnFilter('updatedFrom',from);
                setColumnFilter('updatedTo',to);
              };}(value));
              grid.appendChild(button);
            }
            panel.appendChild(grid); months.appendChild(panel);
          });
          popup.appendChild(months);
          var foot = el('div',{class:'updated-calendar-foot'},
            el('span',{class:'updated-calendar-hint'},mode==='single'?'Choose one date':'Choose a start date, then an end date'),
            el('button',{type:'button',class:'updated-calendar-clear',onclick:function(){close();setColumnFilter('updatedFrom','');setColumnFilter('updatedTo','');}},'Clear dates'));
          popup.appendChild(foot);
        };
        trigger.addEventListener('click',function(e){
          e.stopPropagation();
          if (popup) { close(); return; }
          popup=el('div',{class:'updated-calendar-popover',role:'dialog','aria-label':'Filter by updated date'});
          popup.dataset.mode='range'; render();
          var rect=trigger.getBoundingClientRect();
          popup.style.position='fixed'; popup.style.zIndex='10000';
          popup.style.top=Math.max(12,Math.min(rect.bottom+6,root.innerHeight-390))+'px';
          popup.style.left=Math.max(12,Math.min(rect.left,root.innerWidth-590))+'px';
          doc.body.appendChild(popup); trigger.setAttribute('aria-expanded','true');
          doc.addEventListener('pointerdown',outside,true);
        });
        return el('div',{class:'updated-date-filter'},trigger);
      };
      var columnControl = function (key) {
        var cf = filter.columnFilters || {}, opts;
        if (key === 'status') return sel('Filter status', cf.status || '', [['','Any status'],['open','Open'],['pending','Pending'],['on_hold','On hold'],['solved','Solved'],['closed','Closed']], function (v) { setColumnFilter(key, v); });
        if (key === 'priority') return sel('Filter priority', cf.priority || '', [['','Any priority'],['low','Low'],['normal','Normal'],['high','High'],['urgent','Urgent']], function (v) { setColumnFilter(key, v); });
        if (key === 'assignee') return sel('Filter assignee', cf.assignee || '', [['','Any assignee'],['me','Me'],['none','Unassigned']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { setColumnFilter(key, v); });
        if (key === 'sla') return sel('Filter SLA', cf.sla || '', [['','Any SLA'],['risk','At risk'],['breached','Breached']], function (v) { setColumnFilter(key, v); });
        if (key === 'number') return textColumnFilter('number', '#');
        if (key === 'subject') return textColumnFilter('subject', 'Contains…');
        if (key === 'requester') return textColumnFilter('requester', 'Name or email…');
        if (key === 'updated') return updatedDateFilter(cf);
        return null;
      };
      var shownColumns = ticketColumns.filter(function (k) { return columnDefs[k] && (k !== 'sla' || has('sla')); });
      var rows = list.map(function (t) {
        var tr = el('tr', { class: 'row', tabindex: '0', 'data-number': String(t.number), 'aria-current': String(!!current && current.ticket.number === t.number) });
        if (has('bulk_actions')) tr.appendChild(el('td', { class: 'pick' }, pickBox(t.number)));
        shownColumns.forEach(function (k) { var d = columnDefs[k]; tr.appendChild(el('td', { class: d.cls }, d.cell(t))); });
        tr.addEventListener('click', function () { open(t.number); }); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(t.number); });
        return tr;
      });
      var columnPicker = columnsOpen ? el('div', { class: 'column-picker', role: 'group', 'aria-label': 'Ticket columns' },
        [['status','Status'],['number','Ticket'],['subject','Subject'],['requester','Requester'],['priority','Priority'],['assignee','Assignee'],['sla','SLA'],['updated','Updated']].filter(function (x) { return x[0] !== 'sla' || has('sla'); }).map(function (x) {
          var cb = el('input', { type: 'checkbox', 'aria-label': x[1], 'data-column': x[0] }); cb.checked = ticketColumns.indexOf(x[0]) >= 0;
          cb.addEventListener('change', function () { if (cb.checked) { if (ticketColumns.indexOf(x[0]) < 0) ticketColumns.push(x[0]); } else ticketColumns = ticketColumns.filter(function (k) { return k !== x[0]; }); persistTicketPrefs(); draw(); });
          return el('label', { class: 'chk' }, cb, ' ' + x[1]);
        })) : null;
      return el('div', { class: 'views' }, side, el('div', { class: 'tbl' }, el('div', { class: 'views-head' }, el('div', {}, el('h2', {}, 'All Tickets'), el('p', { class: 'm' }, 'Browse, filter and manage every ticket in this workspace.')), el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn l sm', 'data-columns-toggle': '1', 'aria-expanded': String(columnsOpen), onclick: function () { columnsOpen = !columnsOpen; draw(); } }, 'Columns'), el('button', { type: 'button', class: 'btn l sm', 'data-list-refresh': '1', onclick: function () { var b = main.querySelector('[data-list-refresh]'); if (b) { b.disabled = true; b.textContent = 'Refreshing…'; } refresh().then(function () { say('Ticket list refreshed.'); }); } }, '↻ Refresh'))), columnPicker, bulkBar, el('table', { class: 'ticket-table' }, el('thead', {}, el('tr', {},
        (has('bulk_actions') ? [el('th', {}, (function () { var all = el('input', { type: 'checkbox', 'aria-label': 'Select all tickets on this page', 'data-pick-all': '1' }); all.checked = list.length > 0 && list.every(function (t) { return picked[t.number]; }); all.addEventListener('change', function () { list.forEach(function (t) { if (all.checked) picked[t.number] = true; else delete picked[t.number]; }); draw(); }); return all; })())] : []).concat(shownColumns.map(function (k) {
          var th = el('th', { class: 'ticket-column-head', draggable: 'true', 'data-column-key': k, title: 'Drag to reorder ' + columnDefs[k].label },
            el('span', { class: 'column-head-label' }, columnDefs[k].label),
            el('span', { class: 'column-drag-handle', 'aria-hidden': 'true' }, '⠿'),
            columnControl(k));
          th.addEventListener('dragstart', function (e) { th.classList.add('dragging'); if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', k); } });
          th.addEventListener('dragend', function () { th.classList.remove('dragging'); [].slice.call(th.parentNode.children).forEach(function (x) { x.classList.remove('drag-over'); }); });
          th.addEventListener('dragover', function (e) { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; th.classList.add('drag-over'); });
          th.addEventListener('dragleave', function () { th.classList.remove('drag-over'); });
          th.addEventListener('drop', function (e) {
            e.preventDefault(); th.classList.remove('drag-over');
            var from = e.dataTransfer && e.dataTransfer.getData('text/plain'), to = k;
            if (!from || from === to || ticketColumns.indexOf(from) < 0 || ticketColumns.indexOf(to) < 0) return;
            var ordered = ticketColumns.filter(function (x) { return columnDefs[x] && (x !== 'sla' || has('sla')); });
            var fromIndex = ordered.indexOf(from), toIndex = ordered.indexOf(to);
            if (fromIndex < 0 || toIndex < 0) return;
            ordered.splice(toIndex, 0, ordered.splice(fromIndex, 1)[0]);
            ticketColumns = ordered.concat(ticketColumns.filter(function (x) { return ordered.indexOf(x) < 0; }));
            persistTicketPrefs(); draw();
          });
          return th;
        }))
      )), el('tbody', {}, rows.length ? rows : [el('tr', { class: 'ticket-empty' }, el('td', { colspan: String(shownColumns.length + (has('bulk_actions') ? 1 : 0)) }, 'No tickets match these filters.'))]))));
    }

    // upload files for a ticket (t) or, while writing a new ticket, before it exists (t = null); they wait as chips until the message is sent
    function uploadFiles(t, list) {
      var files = [].slice.call(list || []).slice(0, Math.max(0, 5 - pending.length)), next = Promise.resolve();
      files.forEach(function (f) { next = next.then(function () {
        if (f.size > 5 * 1024 * 1024) return say((f.name || 'That file') + ' is over 5 MB.', true);
        return fetchFn('/api/attachments?org=' + encodeURIComponent(orgId) + (t ? '&ticket=' + t.number : '') + '&name=' + encodeURIComponent(f.name || 'file') + '&type=' + encodeURIComponent(f.type || 'application/octet-stream'), { method: 'POST', credentials: 'same-origin', body: f }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) return say(j.error || 'That file could not be uploaded.', true); pending.push(j.attachment); }); });
      }); });
      return next.then(function () { draw(); });
    }
    // pasting a picture (a screenshot, a copied image) into a message attaches it
    function pasteFiles(t) {
      return function (e) {
        var items = (e.clipboardData && e.clipboardData.items) || [], files = [];
        [].slice.call(items).forEach(function (it) { if (it.kind === 'file' && /^image\//.test(it.type)) { var f = it.getAsFile(); if (f) { var ext = (it.type.split('/')[1] || 'png').replace('jpeg', 'jpg'); files.push(new root.File([f], f.name && f.name !== 'image.png' ? f.name : 'pasted-image-' + Date.now() + '.' + ext, { type: it.type })); } } });
        if (!files.length) return; e.preventDefault(); uploadFiles(t, files);
      };
    }
    // a message as page elements (never as HTML): tables, ``` code, --- lines, `code`, **bold** and links. Without the formatter it is plain text.
    function renderBody(text) {
      if (!root.EffFormat) return el('div', { class: 'mt' }, text);
      return root.EffFormat.toDom(doc, text, el('div', { class: 'mt rich' }));
    }
    // Render the sanitized original HTML for inbound email; keep plain text as the source for editing/search.
    function renderMessageBody(message) {
      if (!message.html_body) return renderBody(message.body);
      var box = el('div', { class: 'mt email-html' });
      box.innerHTML = message.html_body;
      return box;
    }
    function htmlPlain(html) {
      var box = doc.createElement('div'); box.innerHTML = String(html || '');
      [].slice.call(box.querySelectorAll('img')).forEach(function (n) { var alt = n.getAttribute('alt') || ''; if (alt) n.parentNode.replaceChild(doc.createTextNode('[' + alt + ']'), n); else n.parentNode.removeChild(n); });
      [].slice.call(box.querySelectorAll('p,div,h1,h2,h3,h4,h5,h6,li,tr,td,th,blockquote,pre,figcaption')).forEach(function (n) { n.appendChild(doc.createTextNode('\n')); });
      [].slice.call(box.querySelectorAll('br')).forEach(function (n) { n.parentNode.replaceChild(doc.createTextNode('\n'), n); });
      return String(box.textContent || '').replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    }
    function htmlEsc(value) { return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;'); }
    function uploadHelpImage(file) { return fetchFn('/api/help-assets/image?org=' + encodeURIComponent(orgId), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'That picture could not be uploaded.'); return j.url; }); }); }
    // a message box with the formatting toolbar; the plain text box inside stays the value, and a pasted picture is attached
    function editor(ta, t) {
      if (!root.EffEditor) return ta;
      try { return root.EffEditor.enhance(doc, ta, { onImages: function (files) { uploadFiles(t, files); } }); } catch (e) { return ta; }
    }
    function picker(t) {
      var input = el('input', { type: 'file', multiple: 'multiple', 'aria-label': 'Attach files', 'data-attach': '1' });
      input.addEventListener('change', function () { uploadFiles(t, input.files); });
      return el('span', { class: 'attach' }, el('label', { class: 'btn l sm' }, 'Attach', input), pending.map(function (p) { return el('span', { class: 'chip', 'data-pending': p.id }, p.filename + ' (' + size(p.size) + ') ', el('button', { type: 'button', 'aria-label': 'Remove ' + p.filename, onclick: function () { pending = pending.filter(function (x) { return x.id !== p.id; }); api('delete-file', { id: p.id }); draw(); } }, '×')); }));
    }
    var BASE_STATUS = [['open', 'Open'], ['pending', 'Pending'], ['on_hold', 'On hold'], ['solved', 'Solved'], ['closed', 'Closed']];
    // built-in statuses plus the workspace's own (value 'c:<id>'); a ticket's current value is its custom status when it has one
    function statusOpts() { return BASE_STATUS.concat(statuses.map(function (x) { return ['c:' + x.id, x.name]; })); }
    function statusValue(t) { return t.custom_status_id && statuses.some(function (x) { return String(x.id) === String(t.custom_status_id); }) ? 'c:' + t.custom_status_id : t.status; }
    function statusName(t) { var v = statusValue(t); if (v.indexOf('c:') !== 0) return cap(t.status); var x = statuses.filter(function (y) { return 'c:' + y.id === v; })[0]; return x ? x.name : cap(t.status); }
    function statusPatch(v) { return String(v).indexOf('c:') === 0 ? { customStatusId: Number(v.slice(2)) } : { status: v }; }
    function sel(label, value, opts, onchange) { var s = el('select', { 'aria-label': label }, opts.map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === value) op.setAttribute('selected', 'selected'); return op; })); s.value = value; s.addEventListener('change', function () { onchange(s.value); }); return s; }
    var prop = function (label, child) { return el('div', { class: 'prop' }, el('div', { class: 'pl' }, label), child); };

    // ── a ticket in three columns ──
    function ticketPane() {
      var t = current.ticket, x = current.extras || { followers: [], events: [], sides: [], incidents: [], merged: [] }, body = el('textarea', { 'aria-label': 'Message', placeholder: mode === 'note' ? 'Write an internal note. Only your team sees it.' : 'Write a public reply. The customer is emailed.' });
      body.value = draft; body.addEventListener('input', function () { draft = body.value; }); if (mode === 'reply') body.addEventListener('paste', pasteFiles(t));
      var richEditor = root.EffArticleEditor ? root.EffArticleEditor.create(doc, { html: draft ? '<p>' + htmlEsc(draft).replace(/\n/g, '<br>') + '</p>' : '', canSource: has('article_import'), canImport: false, hideImport: true, hideVideo: true, say: say, upload: uploadHelpImage }) : null;
      if (richEditor) richEditor.area.addEventListener('input', function () { body.value = htmlPlain(richEditor.getHtml()); draft = body.value; });
      var bodyBox = richEditor ? richEditor.el : editor(body, t);
      var after = function () { return Promise.all([open(t.number), refresh()]); };
      var update = function (patch) { return api('update', { number: t.number, patch: patch }).then(function (r) { if (!r.ok) return say(r.body.error, true); return after(); }); };
      var fieldInput = function (f, v) {
        var put = function (val) { var c = {}; c[f.key] = val; update({ custom: c }); };
        if (f.type === 'dropdown') return sel(f.label, v === undefined ? '' : String(v), [['', '—']].concat(f.options.map(function (o) { return [o, o]; })), function (x) { put(x); });
        if (f.type === 'checkbox') { var cb = el('input', { type: 'checkbox', 'aria-label': f.label, 'data-field': f.key }); cb.checked = v === true; cb.addEventListener('change', function () { put(cb.checked); }); return cb; }
        var i = el('input', { type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text', 'aria-label': f.label, 'data-field': f.key, value: v === undefined ? '' : String(v), maxlength: '500' });
        i.addEventListener('change', function () { put(i.value); }); return i;
      };
      var act = function (action, extra, ok) { return api(action, Object.assign({ number: t.number }, extra || {})).then(function (r) { if (!r.ok) return say(r.body.error, true); return after().then(function () { if (ok) say(ok); }); }); };
      var send = function (action, force) {
        if (sending) return;
        var richHtml = richEditor ? richEditor.getHtml() : undefined; if (richEditor) body.value = htmlPlain(richHtml);
        draft = body.value; if (!body.value.trim()) { if (action === 'reply' && sendStatus && sendStatus !== t.status) { var ns = sendStatus; sendStatus = ''; return update({ status: ns }).then(function () { say('Status set to ' + ns + '.'); }); } return say('Write a message first, or choose a status in the bar above to change only the status.', true); }
        var status = action === 'reply' ? (sendStatus || (macroPatch && macroPatch.status) || undefined) : undefined, ids = action === 'reply' ? pending.map(function (p) { return p.id; }) : [], mp = action === 'reply' ? macroPatch : null;
        var req = api(action, { number: t.number, body: body.value, html: richHtml, status: status, attachmentIds: ids, seenMessageId: action === 'reply' ? current.messages.reduce(function (m, x) { return Math.max(m, x.id || 0); }, 0) : undefined, force: force === true });
        sending = true; paintSending();
        var done = function () { sending = false; paintSending(); };
        req.then(function (r) {
          if (!r.ok && r.body && r.body.duplicate) { done(); pending = []; draft = ''; return after().then(function () { say(r.body.error); }); }
          if (!r.ok && r.body && r.body.window) { done(); winClosed = true; tplSel = 0; tplVals = []; if (!waTpls) api('whatsapp-templates').then(function (x) { waTpls = x.ok ? x.body.templates : []; draw(); }); return draw(); }
          if (!r.ok && r.body && r.body.conflict) { done(); conflict = { text: r.body.error }; return draw(); }
          if (!r.ok) { done(); return say(r.body.error, true); }
          var n = ''; if (r.body.whatsapp === 'failed') n = 'Saved, but WhatsApp did not deliver it: ' + (r.body.whatsappWhy || 'try again later') + '.'; else if (r.body.email === 'failed') n = 'Saved, but the email could not be sent. Try again later.'; else if (r.body.email === 'skipped') n = r.body.emailWhy === 'no-inbox' ? 'Saved, but no email was sent: set up your support address under Email settings.' : r.body.emailWhy === 'limit' ? 'Saved, but no email was sent: you reached today\'s email limit for your plan.' : '';
          done(); pending = []; draft = ''; macroPatch = null; sendStatus = ''; conflict = null;
          var patch = {}; if (mp && mp.priority) patch.priority = mp.priority; if (mp && mp.add_tags && mp.add_tags.length) patch.tags = (t.tags || []).concat(mp.add_tags);
          return (Object.keys(patch).length ? api('update', { number: t.number, patch: patch }) : Promise.resolve()).then(after).then(function () { if (n) say(n, true); });
        }).catch(function () { done(); say('Could not confirm that the message was sent. Check the conversation before sending it again.', true); });
      };
      var sendShortcut = function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(mode === 'note' ? 'note' : 'reply'); } }; body.addEventListener('keydown', sendShortcut); if (richEditor) richEditor.area.addEventListener('keydown', sendShortcut);
      var who = t.requester_name || t.requester_email;
      // labels: chips plus one box with suggestions
      var addLabel = function (v) { var g = String(v || '').trim(); if (!g) return; update({ tags: (t.tags || []).concat(g) }); };
      var lab = el('input', { 'aria-label': 'Add a label', placeholder: 'Add a label', list: 'dl-labels', maxlength: '30' }); lab.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addLabel(lab.value); } }); lab.addEventListener('change', function () { addLabel(lab.value); });
      var dl = el('datalist', { id: 'dl-labels' }, labels.filter(function (l) { return (t.tags || []).indexOf(l.name) < 0; }).map(function (l) { return el('option', { value: l.name }); }));
      var cc = el('input', { 'aria-label': 'CC', value: (t.cc || []).join(', '), placeholder: 'Add people to copy on replies' }); cc.addEventListener('change', function () { update({ cc: cc.value }); });
      var mergeBox = el('input', { 'aria-label': 'Merge into ticket number', placeholder: 'Merge into #', inputmode: 'numeric', maxlength: '9' });
      var props = el('aside', { class: 'col props', 'aria-label': 'Ticket properties' },
        prop('Requester', el('div', {}, who)),
        prop('Assignee', sel('Assignee', t.assignee_id || '', [['', 'Unassigned']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { update({ assigneeId: v || null }); })),
        prop('Priority', el('div', {}, sel('Priority', t.priority, [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], function (v) { update({ priority: v }); }), t.priority === 'low' || t.priority === 'normal' ? el('button', { type: 'button', class: 'btn l sm', 'data-escalate': '1', onclick: function () { update({ priority: 'high' }); } }, 'Escalate to high') : null)),
        prop('Status', sel('Status', statusValue(t), statusOpts(), function (v) { update(statusPatch(v)); })),
        has('custom_fields') ? fields.map(function (f) { return prop(f.label, fieldInput(f, (t.custom || {})[f.key])); }) : null,
        prop('Type', sel('Type', t.type || 'question', [['question', 'Question'], ['incident', 'Incident'], ['problem', 'Problem'], ['task', 'Task']], function (v) { update({ type: v }); })),
        prop('Queue', has('queues') ? sel('Queue', t.queue_id ? String(t.queue_id) : '', [['', 'No queue']].concat(queues.map(function (q) { return [String(q.id), q.name]; })), function (v) { update({ queueId: v || null }); }) : lock('queues')),
        prop('Client', has('clients') ? sel('Client', t.client_id ? String(t.client_id) : '', [['', 'No client']].concat(clients.map(function (k) { return [String(k.id), k.name]; })), function (v) { update({ clientId: v || null }); }) : lock('clients')),
        prop('Labels', el('div', {}, el('div', { class: 'chips' }, (t.tags || []).map(function (g) { return el('span', { class: 'chip', 'data-label': g }, g, el('button', { type: 'button', 'aria-label': 'Remove the label ' + g, onclick: function () { update({ tags: (t.tags || []).filter(function (y) { return y !== g; }) }); } }, '×')); })), lab, dl)),
        prop('CC', cc),
        prop('Follow', el('button', { type: 'button', class: 'btn l sm', 'data-follow': '1', onclick: function () { act('follow', { on: !x.following }); } }, x.following ? 'Following · stop' : 'Follow this ticket')),
        prop('Requested', el('div', {}, when(t.created_at))), prop('Last update', el('div', {}, ago(t.updated_at))),
        prop('Merge', mergeArmed ? el('div', {}, el('div', { class: 'm' }, 'Merge #' + t.number + ' into #' + mergeArmed + '? The messages move over and this ticket is closed. This cannot be undone.'), el('button', { type: 'button', class: 'btn sm', 'data-merge-confirm': '1', onclick: function () { var into = mergeArmed; act('merge', { into: into }, 'Merged into #' + into + '.'); } }, 'Yes, merge'), ' ', el('button', { type: 'button', class: 'btn l sm', onclick: function () { mergeArmed = false; draw(); } }, 'Cancel')) : el('div', {}, mergeBox, el('button', { type: 'button', class: 'btn l sm', 'data-merge': '1', onclick: function () { var v = Number(String(mergeBox.value).replace('#', '')); if (!v || v === t.number) return say('Enter the number of another ticket.', true); mergeArmed = v; draw(); } }, 'Merge into…'))));
      // the toolbar above the conversation: refresh, timeline, AI summary, print and download
      var exportUrl = function (fmt, mid) { return '/api/ticket-export?org=' + encodeURIComponent(orgId) + '&number=' + t.number + '&format=' + fmt + (mid ? '&message=' + mid : '') + (exportNotes ? '&notes=1' : '') + (fmt === 'print' ? '&auto=1' : ''); };
      var timelineEl = function () {
        var rows = (x.events || []).map(function (e) { return { at: e.created_at, node: el('li', { 'data-event': e.kind, class: 'tl-e' }, el('span', { class: 'dot' }), el('b', {}, e.actor_name || 'Someone'), ' ' + e.detail, el('span', { class: 'm' }, ' · ' + when(e.created_at))) }; })
          .concat(current.messages.filter(function (m) { return m.kind !== 'system'; }).map(function (m) { return { at: m.created_at, node: el('li', { 'data-tl-message': String(m.id), class: 'tl-m ' + m.kind }, el('span', { class: 'dot' }), el('b', {}, m.author_name || (m.kind === 'requester' ? t.requester_email : 'Agent')), ' ' + ({ requester: 'wrote', agent: 'replied', note: 'added an internal note' })[m.kind], el('span', { class: 'm' }, ' · ' + when(m.created_at)), el('div', { class: 'tl-prev' }, String(m.body).replace(/\s+/g, ' ').slice(0, 160))) }; }));
        rows.sort(function (a, b) { return new Date(a.at) - new Date(b.at); });
        return el('ul', { class: 'timeline tl-full', 'data-timeline-view': '1' }, rows.map(function (r) { return r.node; }));
      };
      var aiBtn = function (label, key, run) { return el('button', Object.assign({ type: 'button', class: 'btn l sm', 'data-ai': key, onclick: run }, aiBusy ? { disabled: 'disabled' } : {}), aiBusy === key ? 'Working…' : label); };
      var aiRun = function (key, action, extra, done) { aiBusy = key; draw(); api(action, Object.assign({ number: t.number }, extra)).then(function (r) { aiBusy = ''; if (!r.ok) { draw(); return say(r.body.error || 'The AI could not answer.', true); } done(r.body); draw(); }); };
      var hdrTools = el('div', { class: 'chtools', role: 'toolbar', 'aria-label': 'Conversation tools' },
        el('button', { type: 'button', class: 'ib', 'data-refresh': '1', title: 'Refresh: load the latest messages and changes', 'aria-label': 'Refresh', onclick: function () { after().then(function () { say('Up to date.'); }); } }, '↻'),
        el('button', { type: 'button', class: 'ib', 'data-timeline': '1', title: showTimeline ? 'Back to the conversation' : 'History: show the ticket timeline', 'aria-label': 'History', 'aria-pressed': String(showTimeline), onclick: function () { showTimeline = !showTimeline; draw(); } }, '🕘'),
        sel('Print or download this conversation', '', [['', '⤓ Print / download'], ['print', 'Print or save as PDF'], ['eml', 'Download as .eml']], function (v) { if (v) root.open(exportUrl(v), '_blank', 'noopener'); }));
      var tools = el('div', { class: 'ctools', role: 'toolbar', 'aria-label': 'More conversation tools' },
        has('ai_assist') ? aiBtn('✦ Summarize', 'summary', function () { aiRun('summary', 'ai-summary', {}, function (b) { summaries[t.number] = b.text; }); }) : null,
        el('label', { class: 'chk m' }, (function () { var cb = el('input', { type: 'checkbox', 'aria-label': 'Include internal notes in prints and downloads' }); cb.checked = exportNotes; cb.addEventListener('change', function () { exportNotes = cb.checked; }); return cb; })(), ' include internal notes when printing or downloading'));
      var dlv = {}; (current.delivery || []).forEach(function (d) { dlv[d.message_id] = d; });
      var DLV = { sent: 'Sent', delivered: 'Delivered', read: 'Read', delayed: 'Delayed, still trying', bounced: 'Bounced', complained: 'Marked as spam', failed: 'Not delivered' };
      var msgs = current.messages.map(function (m) {
        if (m.kind === 'system') return el('div', { class: 'msg-row sys' }, el('span', { class: 'sysmsg', 'data-kind': 'system' }, m.body));
        var side = m.kind === 'requester' ? 'in' : 'out', mine = (m.kind === 'agent' || m.kind === 'note') && m.author_id === meId, editing1 = editMsg === m.id, ed = null, edBox = null;
        if (editing1) { ed = el('textarea', { 'aria-label': 'Edit message' }); ed.value = m.body; edBox = editor(ed, t); }
        return el('div', { class: 'msg-row ' + side }, avatarEl(m.kind, m.author_name, avatarOf(m.author_id)),
          el('div', { class: 'msg-b ' + m.kind, 'data-kind': m.kind }, el('div', { class: 'mh' }, el('strong', {}, m.author_name || (m.kind === 'requester' ? t.requester_email : 'Agent')), el('span', { class: 'm' }, (m.kind === 'note' ? ' · Internal note · ' : ' · ') + when(m.created_at) + (m.edited_at ? ' · edited' : '')), dlv[m.id] ? el('span', { class: 'dlv ' + (dlv[m.id].status === 'bounced' || dlv[m.id].status === 'complained' ? 'failed' : dlv[m.id].status), 'data-delivery': dlv[m.id].status, title: dlv[m.id].error || '' }, dlv[m.id].status === 'failed' || dlv[m.id].status === 'bounced' || dlv[m.id].status === 'complained' ? ' · ' + (DLV[dlv[m.id].status] || 'Not sent') + (dlv[m.id].error ? ': ' + dlv[m.id].error : '') : ' · ' + DLV[dlv[m.id].status]) : null, el('a', { class: 'edit', href: exportUrl('print', m.id), target: '_blank', rel: 'noopener', 'data-print-msg': String(m.id) }, 'Print'), el('a', { class: 'edit', href: exportUrl('eml', m.id), target: '_blank', rel: 'noopener', 'data-eml-msg': String(m.id) }, '.eml'), mine && !editing1 ? el('button', { type: 'button', class: 'edit', 'data-edit': String(m.id), onclick: function () { editMsg = m.id; draw(); } }, 'Edit') : null),
            editing1 ? el('div', {}, edBox, el('button', { type: 'button', class: 'btn sm', 'data-edit-save': '1', onclick: function () { api('edit-message', { number: t.number, messageId: m.id, body: ed.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); editMsg = null; return after(); }); } }, 'Save'), ' ', el('button', { type: 'button', class: 'btn l sm', onclick: function () { editMsg = null; draw(); } }, 'Cancel')) : renderMessageBody(m),
            translated[m.id] ? el('div', { class: 'tr', 'data-translated': String(m.id) }, el('div', { class: 'm' }, translated[m.id].note), translated[m.id].text ? el('div', { class: 'mt' }, translated[m.id].text) : null) : null,
            m.kind === 'requester' && has('translation') && !translated[m.id] ? el('button', { type: 'button', class: 'edit', 'data-translate': String(m.id), onclick: function () { translate(m); } }, 'Translate') : null,
            (m.attachments || []).filter(function (a) { return !(m.html_body && m.html_body.indexOf('/api/attachments/' + a.id) >= 0); }).length ? el('div', { class: 'files' }, el('div', { class: 'files-title' }, 'Attachments'), el('div', { class: 'files-list' }, m.attachments.filter(function (a) { return !(m.html_body && m.html_body.indexOf('/api/attachments/' + a.id) >= 0); }).map(function (a) { var u = '/api/attachments/' + encodeURIComponent(a.id) + '?org=' + encodeURIComponent(orgId), pic = /^image\/(png|jpeg|gif|webp)$/.test(a.content_type || a.contentType || ''); return el('span', { class: 'file1' }, pic ? el('a', { href: u, target: '_blank', rel: 'noopener', 'data-thumb': a.id }, el('img', { src: u, alt: a.filename, class: 'thumb', loading: 'lazy' })) : null, el('a', { href: u, 'data-file': a.id, download: a.filename }, a.filename + ' (' + size(a.size) + ')')); }))) : null));
      });
      var modeBtn = function (m, label) { return el('button', { type: 'button', role: 'tab', 'data-mode': m, 'aria-selected': String(mode === m), onclick: function () { var ta = main.querySelector('.compose textarea'); if (richEditor) { draft = htmlPlain(richEditor.getHtml()); body.value = draft; } else if (ta) draft = ta.value; mode = m; draw(); } }, label); };
      var macroSel = macros.length && mode === 'reply' ? sel('Insert a macro', '', [['', 'Insert a macro…']].concat(macros.map(function (m) { return [String(m.id), m.name]; })), function (v) { var m = macros.filter(function (y) { return String(y.id) === v; })[0]; if (!m) return; var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; var first = String(t.requester_name || '').split(' ')[0] || 'there'; draft = (draft ? draft + '\n\n' : '') + m.body.replace(/\{\{\s*name\s*\}\}/g, first).replace(/\{\{\s*agent\s*\}\}/g, meName); macroPatch = { status: m.status, priority: m.priority, add_tags: m.add_tags }; draw(); }) : null;
      var mentionSel = mode === 'note' && agents.length > 1 ? sel('Mention a teammate', '', [['', '@ Mention a teammate…']].concat(agents.filter(function (a) { return a.id !== meId; }).map(function (a) { return [String(a.email).split('@')[0], a.name || a.email]; })), function (v) { if (!v) return; var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; draft = (draft ? draft + ' ' : '') + '@' + v + ' '; draw(); }) : null;
      var chosen = sendStatus || t.status, statusSel = sel('Choose the status to submit as', chosen, [['open', 'Submit as Open'], ['pending', 'Submit as Pending'], ['on_hold', 'Submit as On hold'], ['solved', 'Submit as Solved']], function (v) { var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; sendStatus = v === t.status ? '' : v; draw(); });
      var aiBar = has('ai_assist') ? el('div', { class: 'aibar', role: 'group', 'aria-label': 'AI assist' },
        mode === 'reply' ? aiBtn('✦ Suggest a reply', 'suggest', function () { var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; aiRun('suggest', 'ai-suggest', {}, function (b) { draft = (draft ? draft + '\n\n' : '') + b.text; }); }) : null,
        sel('Rewrite your draft with AI', '', [['', '✦ Rewrite…'], ['friendlier', 'Friendlier'], ['shorter', 'Shorter'], ['clearer', 'Clearer'], ['formal', 'More formal'], ['fix', 'Fix spelling and grammar']], function (v) { var ta = main.querySelector('.compose textarea'); var text = richEditor ? htmlPlain(richEditor.getHtml()) : ta ? ta.value : draft; if (richEditor) { body.value = text; draft = text; } if (!v) return; if (!String(text).trim()) return say('Write a draft first, then choose how to rewrite it.', true); aiRun('rewrite', 'ai-rewrite', { mode: v, text: text }, function (b) { draft = b.text; }); }),
        el('span', { class: 'm' }, 'Drafts only. You read and send.')) : null;
      var actions = mode === 'note' ? el('button', { class: 'btn', type: 'button', 'data-note': '1', onclick: function () { send('note'); } }, 'Add internal note') : el('span', { class: 'split' }, el('button', { class: 'btn', type: 'button', 'data-reply': '1', onclick: function () { send('reply'); } }, 'Submit as ' + cap(chosen)), statusSel);
      var center = el('section', { class: 'col conv' }, el('div', { class: 'ch' }, hdrTools, el('h2', {}, '#' + t.number + ' ' + t.subject), (function () { var b = el('div', { class: 'collide' + (others.some(function (o) { return o.typing; }) ? ' typing' : ''), role: 'status', 'data-collide': '1' }, othersText()); b.hidden = !others.length; return b; })(), el('div', { class: 'm' }, (t.requester_name ? t.requester_name + ' · ' : '') + t.requester_email + ' · ', el('span', { class: 'badge s-' + t.status }, cap(t.status)), t.type && t.type !== 'question' ? ' · ' + cap(t.type) : ''), t.sla ? el('div', { class: 'slas' }, slaChips(t.sla)) : null, t.csat ? el('div', { class: 'm', 'data-csat': t.csat.good ? 'good' : 'bad' }, (t.csat.good ? '👍 Customer rated the support good' : '👎 Customer rated the support bad') + (t.csat.comment ? ': “' + t.csat.comment + '”' : '')) : null),
        tools,
        summaries[t.number] ? el('div', { class: 'aisum', 'data-ai-summary': '1' }, el('strong', {}, 'AI summary'), renderBody(summaries[t.number]), el('button', { type: 'button', class: 'btn l sm', onclick: function () { delete summaries[t.number]; draw(); } }, 'Hide')) : null,
        el('div', { class: 'thread' }, showTimeline ? timelineEl() : msgs),
        winClosed ? (function () {
          var tl = waTpls || [], tp = tl[tplSel], kids = [el('strong', {}, 'WhatsApp only lets you reply with free text within 24 hours of the customer\'s last message. Send an approved template to start the conversation again. Your text is kept.'), ' '];
          if (!waTpls) kids.push(el('span', { class: 'm' }, 'Loading templates…'));
          else if (!tl.length) kids.push(el('span', { class: 'm' }, 'No templates yet. An admin can add them under Manage, WhatsApp.'));
          else {
            var ts = el('select', { 'aria-label': 'Template', 'data-wa-tpl': '1', onchange: function () { tplSel = Number(ts.value); tplVals = []; draw(); } }, tl.map(function (x, i) { return el('option', { value: String(i), selected: i === tplSel }, x.name + ' (' + x.language + ')'); }));
            kids.push(ts, el('p', { class: 'm', 'data-wa-tpl-body': '1' }, tp.body));
            for (var vi = 0; vi < tp.slots; vi++) (function (k) { var inp = el('input', { 'aria-label': 'Variable ' + (k + 1), 'data-wa-var': String(k + 1), maxlength: '200', placeholder: 'Variable ' + (k + 1), value: tplVals[k] || '' }); inp.addEventListener('input', function () { tplVals[k] = inp.value; }); kids.push(inp, ' '); })(vi);
            kids.push(el('button', { type: 'button', class: 'btn sm', 'data-wa-tpl-send': '1', onclick: function () { api('whatsapp-template-send', { number: t.number, name: tp.name, language: tp.language, params: tplVals.slice(0, tp.slots).map(function (v) { return v || ''; }), status: sendStatus || undefined }).then(function (r) { if (!r.ok) return say(r.body.error, true); winClosed = false; draft = ''; sendStatus = ''; return after().then(function () { if (r.body.whatsapp === 'failed') say('Saved, but WhatsApp did not deliver it: ' + (r.body.whatsappWhy || 'try again later') + '.', true); }); }); } }, 'Send template'), ' ', el('button', { type: 'button', class: 'btn l sm', onclick: function () { winClosed = false; draw(); } }, 'Cancel'));
          }
          return el('div', { class: 'conflict', role: 'alert', 'data-wa-window': '1' }, kids);
        })() : null,
        conflict ? el('div', { class: 'conflict', role: 'alert', 'data-conflict': '1' }, el('strong', {}, conflict.text), ' ', el('button', { type: 'button', class: 'btn sm', 'data-send-anyway': '1', onclick: function () { conflict = null; send('reply', true); } }, 'Send anyway'), ' ', el('button', { type: 'button', class: 'btn l sm', 'data-show-new': '1', onclick: function () { var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; conflict = null; after(); } }, 'Show what is new')) : null,
        el('div', { class: 'compose' }, el('div', { class: 'modes', role: 'tablist' }, modeBtn('reply', 'Public reply'), modeBtn('note', 'Internal note'), macroSel, mentionSel), aiBar, bodyBox, el('div', { class: 'cbar' }, picker(t), el('span', { class: 'hint m' }, 'Ctrl or ⌘ + Enter to send'), actions)));
      // right column: requester, client, linked tickets, side conversations, followers, timeline
      var cards = [el('h3', {}, 'Requester'), el('div', { class: 'pcard requester-card' }, el('button', { type:'button',class:'requester-profile-link',onclick:function(){openContact(t.requester_email);}},el('span',{class:'av in','aria-hidden':'true'},initial(who)),el('span',{},el('strong',{},who),el('span',{class:'m'},t.requester_email),el('small',{},'View contact profile →'))),el('div', { class: 'm' }, 'Channel: ' + (t.channel || 'web')))];
      cards.push(el('h3', {}, 'About this company'));
      if (!has('clients')) cards.push(el('div', { class: 'pcard' }, lock('clients')));
      else if (!x.client) cards.push(el('div', { class: 'pcard m' }, 'No company linked yet. Add a company domain or link this contact to a company from their profile.'));
      else { var k = x.client, notes = el('textarea', { 'aria-label': 'Client notes', placeholder: 'Notes for the team: contacts, history, what to know. The client never sees this.' }); notes.value = k.notes || '';
        cards.push(el('div', { class: 'pcard', 'data-client': String(k.id) }, el('strong', {}, k.name), el('div', { class: 'm' }, k.stats.total + ' tickets · ' + k.stats.open + ' open · ' + k.stats.solved + ' solved'), notes, el('button', { type: 'button', class: 'btn l sm', 'data-client-notes': '1', onclick: function () { api('client-notes', { id: k.id, notes: notes.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); say('Notes saved.'); }); } }, 'Save notes'), ' ', el('button', { type: 'button', class: 'btn l sm', 'data-client-tickets': '1', onclick: function () { closePanes(); filter = { status: '', assignee: '', q: '', client: String(k.id) }; refresh(); } }, 'All tickets'), el('div', { class: 'pl m', style: 'margin-top:10px' }, 'People'), k.people.map(function (p) { return el('div', { class: 'm' }, (p.name ? p.name + ' · ' : '') + p.email + ' · ' + p.tickets); }))); }
      cards.push(el('h3', {}, 'Linked tickets'));
      if (!has('linked_tickets')) cards.push(el('div', { class: 'pcard' }, lock('linked_tickets')));
      else {
        var lk = el('div', { class: 'pcard' });
        if (x.problem) { lk.appendChild(el('div', { class: 'm' }, 'Incident of problem:')); lk.appendChild(el('button', { type: 'button', class: 'lnk', 'data-open': String(x.problem.number), onclick: function () { open(x.problem.number); } }, '#' + x.problem.number + ' ' + x.problem.subject + ' (' + x.problem.status + ')')); lk.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-unlink': '1', onclick: function () { act('unlink'); } }, 'Unlink')); }
        else if (t.type === 'problem' || x.incidents.length) { lk.appendChild(el('div', { class: 'm' }, 'Incidents of this problem:')); x.incidents.forEach(function (i) { lk.appendChild(el('button', { type: 'button', class: 'lnk', 'data-open': String(i.number), onclick: function () { open(i.number); } }, '#' + i.number + ' ' + i.subject + ' (' + i.status + ')')); }); lk.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-resolve': '1', onclick: function () { act('problem-resolve', {}, 'Problem and its incidents solved.'); } }, 'Solve problem and incidents')); }
        else { var pn = el('input', { 'aria-label': 'Problem ticket number', placeholder: 'Problem ticket #', inputmode: 'numeric', maxlength: '9' }); lk.appendChild(pn); lk.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-link': '1', onclick: function () { act('link', { problem: Number(String(pn.value).replace('#', '')) }); } }, 'Link as incident')); }
        cards.push(lk);
      }
      if (x.merged.length) { cards.push(el('h3', {}, 'Merged into this ticket')); cards.push(el('div', { class: 'pcard' }, x.merged.map(function (m) { return el('div', { class: 'm' }, '#' + m.number + ' ' + m.subject); }))); }

      // External project issues: search/link existing work or create a provider-native issue without leaving this ticket.
      function externalIssuePanel() {
        var ui=externalIssueUi[t.number]||(externalIssueUi[t.number]={provider:'linear',mode:'idle',connections:[],links:[],loaded:false,loading:false,query:'',results:[],catalog:null,options:null,projectId:'',issueTypeId:'',title:'[EffDesk #'+t.number+'] '+t.subject,description:'EffDesk ticket #'+t.number+'\\nRequester: '+(t.requester_name||t.requester_email)+'\\n\\n'+((current.messages||[]).filter(function(m){return m.kind==='requester';}).slice(-1)[0]?.body||''),priority:t.priority==='urgent'?'1':t.priority==='high'?'2':t.priority==='low'?'4':'3',assigneeId:'',projectId2:'',stateId:'',labelIds:[],fields:{},templates:[],templatesLoadedProvider:'',templateId:'',template:null,busy:false,error:''});
        var request=function(method,route,data){
          var parts=String(route).split('&'),routePath=parts.shift(),query=parts.join('&'),url='/api/integrations/'+routePath+'?org='+encodeURIComponent(orgId)+(query?'&'+query:'');
          return fetchFn(url,{method:method,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(Object.assign({orgId:orgId},data||{}))}).then(function(r){return r.json().catch(function(){return{};}).then(function(body){if(!r.ok)throw new Error(body.error||'External issue request failed.');return body;});});
        };
        var redraw=function(){if(current&&current.ticket.number===t.number)draw();};
        var loadContext=function(){
          if(ui.loaded||ui.loading)return;
          ui.loading=true;
          request('GET','ticket-context&ticketNumber='+t.number).then(function(d){ui.connections=d.connections||[];ui.links=d.links||[];ui.loaded=true;ui.loading=false;if(!ui.connections.some(function(x){return x.provider===ui.provider;}))ui.provider=ui.connections[0]?.provider||'linear';redraw();}).catch(function(e){ui.loading=false;ui.error=e.message;redraw();});
        };
        var connected=function(p){return ui.connections.some(function(x){return x.provider===p;});};
        var loadTemplates=function(){
          if(ui.templatesLoadedProvider===ui.provider)return Promise.resolve(ui.templates);
          return request('GET','templates&provider='+ui.provider).then(function(d){ui.templates=d.templates||[];ui.templatesLoadedProvider=ui.provider;return ui.templates;});
        };
        var chooseTemplate=function(id){
          ui.templateId=id||'';ui.template=null;ui.fields={};ui.title='[EffDesk #'+t.number+'] '+t.subject;ui.description='EffDesk ticket #'+t.number+'\\nRequester: '+(t.requester_name||t.requester_email);
          ui.projectId='';ui.issueTypeId='';ui.options=null;
          if(id){
            ui.template=ui.templates.filter(function(x){return String(x.id)===String(id);})[0]||null;
            if(ui.template){
              ui.projectId=ui.template.project_id||'';ui.issueTypeId=ui.template.issue_type_id||'';
              var cfg=ui.template.form_config||{},fields=cfg.fields||[];
              fields.forEach(function(f){
                var mapped={'ticket.subject':t.subject,'ticket.description':(current.messages||[]).filter(function(m){return m.kind==='requester';}).slice(-1)[0]?.body||'','ticket.number':String(t.number),'ticket.requester_name':t.requester_name||'','ticket.requester_email':t.requester_email||'','ticket.priority':t.priority||''}[f.mapping];
                if(f.defaultValue)ui.fields[f.id]=f.defaultValue;
                if(mapped!==undefined&&mapped!=='')ui.fields[f.id]=mapped;
              });
              if(ui.fields.title!==undefined)ui.title=ui.fields.title;
              if(ui.fields.description!==undefined)ui.description=ui.fields.description;else if(!fields.some(function(f){return f.id==='description';}))ui.description='';
              if(ui.fields.priority!==undefined){ui.priority=String(ui.fields.priority);if(ui.provider==='linear'&&!/^\d+$/.test(ui.priority)){ui.priority=({urgent:'1',high:'2',normal:'3',low:'4'})[ui.priority.toLowerCase()]||'3';ui.fields.priority=ui.priority;}}
              if(ui.fields.assigneeId!==undefined)ui.assigneeId=ui.fields.assigneeId;
              if(ui.fields.projectId2!==undefined)ui.projectId2=ui.fields.projectId2;
              if(ui.fields.stateId!==undefined)ui.stateId=ui.fields.stateId;
              if(Array.isArray(ui.fields.labelIds))ui.labelIds=ui.fields.labelIds;else if(typeof ui.fields.labelIds==='string'){ui.labelIds=ui.fields.labelIds.split(',').map(function(x){return x.trim();}).filter(Boolean);ui.fields.labelIds=ui.labelIds;}
            }
          }
          if(ui.projectId)loadOptions(ui.projectId,ui.issueTypeId||'').then(redraw).catch(function(e){ui.error=e.message;redraw();});else redraw();
        };
        var templateField=function(id){return ui.template?(ui.template.form_config?.fields||[]).filter(function(x){return x.id===id&&x.visible!==false;})[0]||null:null;};

        var loadCatalog=function(){
          if(ui.catalog&&ui.catalog.provider===ui.provider)return Promise.resolve(ui.catalog);
          ui.catalog=null;ui.options=null;ui.projectId='';ui.projectId2='';ui.stateId='';ui.labelIds=[];ui.issueTypeId='';
          return request('GET','catalog&provider='+ui.provider).then(function(d){ui.catalog={provider:ui.provider,items:d.items||[],cloudId:d.cloudId,siteHost:d.siteHost};return ui.catalog;});
        };
        var loadOptions=function(project,issueType){
          ui.options=null;
          return request('GET','issue-options&provider='+ui.provider+'&project='+encodeURIComponent(project||'')+'&issueType='+encodeURIComponent(issueType||'')).then(function(d){ui.options=d;return d;});
        };
        var runSearch=function(){
          if(ui.query.trim().length<2)return;
          ui.busy=true;ui.error='';ui.results=[];redraw();
          request('GET','search&provider='+ui.provider+'&q='+encodeURIComponent(ui.query.trim())).then(function(d){ui.results=d.items||[];ui.busy=false;redraw();}).catch(function(e){ui.busy=false;ui.error=e.message;redraw();});
        };
        var linkExisting=function(issue){
          ui.busy=true;ui.error='';redraw();
          request('POST','link-existing',{provider:ui.provider,ticketNumber:t.number,issueId:issue.id}).then(function(){ui.mode='idle';ui.busy=false;ui.results=[];ui.loaded=false;loadContext();}).catch(function(e){ui.busy=false;ui.error=e.message;redraw();});
        };
        var createIssue=function(){
          if(!ui.projectId||!String(ui.title||'').trim())return;
          ui.busy=true;ui.error='';redraw();
          request('POST','create-issue',{provider:ui.provider,ticketNumber:t.number,templateId:ui.templateId||undefined,projectId:ui.projectId,projectId2:ui.projectId2,stateId:ui.stateId,labelIds:ui.labelIds,issueTypeId:ui.issueTypeId,title:ui.title,description:ui.description,priority:ui.priority,assigneeId:ui.assigneeId,fields:ui.fields}).then(function(){ui.mode='idle';ui.busy=false;ui.loaded=false;ui.catalog=null;loadContext();}).catch(function(e){ui.busy=false;ui.error=e.message;redraw();});
        };
        loadContext();
        var box=el('div',{class:'pcard external-issues'});
        if(!ui.loaded){box.appendChild(el('p',{class:'m'},ui.loading?'Loading external connections…':ui.error||'Loading…'));return box;}
        var connectedProviders=['linear','jira'].filter(connected);
        if(!connectedProviders.length){
          box.appendChild(el('p',{class:'m'},'No external project tools are connected to this workspace.'));
          box.appendChild(el('a',{class:'btn l sm',href:'https://app.effdesk.com/integrations.html?org='+encodeURIComponent(orgId)},'Configure integrations'));
          return box;
        }
        var tabs=el('div',{class:'external-provider-tabs',role:'tablist','aria-label':'External issue provider'});
        connectedProviders.forEach(function(p){tabs.appendChild(el('button',{type:'button',class:'external-provider-tab'+(ui.provider===p?' active':''),'aria-selected':String(ui.provider===p),onclick:function(){ui.provider=p;ui.mode='idle';ui.catalog=null;ui.options=null;ui.results=[];ui.templatesLoadedProvider='';ui.templates=[];ui.templateId='';ui.template=null;ui.error='';redraw();}},p==='linear'?'◈ Linear':'🔷 Jira'));});
        box.appendChild(tabs);
        if(connectedProviders.length<2)box.appendChild(el('a',{class:'external-connect-another',href:'https://app.effdesk.com/integrations.html?org='+encodeURIComponent(orgId)},'Connect '+(connectedProviders[0]==='linear'?'Jira':'Linear')+' too'));
        var links=ui.links.filter(function(x){return x.provider===ui.provider;});
        if(links.length){
          links.forEach(function(link){
            box.appendChild(el('div',{class:'external-linked-issue'},
              el('div',{class:'external-linked-head'},el('strong',{},link.external_issue_key||'External issue'),el('span',{class:'external-sync-state'},link.last_synced_at?'Synced':'Linked')),
              el('a',{href:link.external_issue_url||'#',target:'_blank',rel:'noopener'},link.external_issue_key||link.external_issue_id),
              el('button',{type:'button',class:'btn l sm',onclick:function(){if(!root.confirm||root.confirm('Unlink this issue from EffDesk? The issue will not be deleted.'))request('POST','unlink',{ticketNumber:t.number,linkId:link.id}).then(function(){ui.loaded=false;loadContext();}).catch(function(e){ui.error=e.message;redraw();});}},'Unlink')
            ));
          });
        } else box.appendChild(el('p',{class:'m'},'No '+(ui.provider==='linear'?'Linear':'Jira')+' issues linked to this ticket yet.'));
        var actions=el('div',{class:'external-issue-actions'},
          el('button',{type:'button',class:'btn l sm',onclick:function(){ui.mode=ui.mode==='search'?'idle':'search';ui.error='';ui.results=[];redraw();}},'⌕ Search existing'),
          el('button',{type:'button',class:'btn sm',onclick:function(){ui.mode=ui.mode==='create'?'idle':'create';ui.error='';redraw();if(ui.mode==='create')Promise.all([loadCatalog(),loadTemplates()]).then(redraw).catch(function(e){ui.error=e.message;redraw();});}},'+ Create new'));
        box.appendChild(actions);
        if(ui.error)box.appendChild(el('p',{class:'external-issue-error',role:'alert'},ui.error));
        if(ui.mode==='search'){
          var query=el('input',{type:'search',class:'external-issue-search','aria-label':'Search external issues',placeholder:'Search by issue key or title',value:ui.query});
          query.addEventListener('input',function(){ui.query=query.value;});
          query.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();runSearch();}});
          box.appendChild(el('div',{class:'external-issue-search-row'},query,el('button',{type:'button',class:'btn sm',onclick:runSearch},ui.busy?'Searching…':'Search')));
          if(ui.results.length)ui.results.forEach(function(issue){box.appendChild(el('div',{class:'external-search-result'},el('div',{},el('strong',{},issue.key+' · '+issue.title),el('div',{class:'m'},[issue.team,issue.project,issue.status].filter(Boolean).join(' · '))),el('button',{type:'button',class:'btn l sm',onclick:function(){linkExisting(issue);}},'Link')));});
          else if(!ui.busy&&ui.query.length>=2)box.appendChild(el('p',{class:'m'},'No results yet. Search to find matching issues.'));
        }
        if(ui.mode==='create'){
          if(!ui.catalog){box.appendChild(el('p',{class:'m'},'Loading provider projects…'));return box;}
          var projectItems=ui.catalog.items||[];
          var projectLabel=ui.provider==='linear'?'Linear team':'Jira project';
          if(ui.templates.length){
            var templateSelect=el('select',{'aria-label':'Issue template'},[el('option',{value:''},'Use standard issue form')].concat(ui.templates.map(function(x){return el('option',{value:String(x.id)},x.name+' · '+(x.project_name||x.project_id));})));
            templateSelect.value=ui.templateId||'';
            templateSelect.addEventListener('change',function(){chooseTemplate(templateSelect.value);});
            box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Saved issue template'),templateSelect));
          }

          var projectSelect=el('select',{'aria-label':projectLabel,disabled:ui.template?'disabled':null},[el('option',{value:''},'Choose '+projectLabel.toLowerCase()+'…')].concat(projectItems.map(function(x){return el('option',{value:x.id},x.name+(x.key?' ('+x.key+')':''));})));
          projectSelect.value=ui.projectId||'';
          projectSelect.addEventListener('change',function(){ui.projectId=projectSelect.value;ui.options=null;ui.issueTypeId='';ui.fields={};if(ui.projectId)loadOptions(ui.projectId,'').then(function(d){if(ui.provider==='jira'&&d.issueTypes&&d.issueTypes.length===1){ui.issueTypeId=d.issueTypes[0].id;return loadOptions(ui.projectId,ui.issueTypeId);}}).then(redraw).catch(function(e){ui.error=e.message;redraw();});else redraw();});
          if(ui.template)box.appendChild(el('p',{class:'m'},'This template creates issues in '+(ui.template.project_name||ui.template.project_id)+(ui.template.issue_type_name?' · '+ui.template.issue_type_name:'' )+'.'));else box.appendChild(el('label',{class:'external-issue-field'},el('span',{},projectLabel),projectSelect));
          if(!ui.template&&ui.projectId&&ui.options&&ui.provider==='jira'&&ui.options.issueTypes){
            var types=ui.options.issueTypes;
            var typeSelect=el('select',{'aria-label':'Jira issue type'},[el('option',{value:''},'Choose issue type…')].concat(types.map(function(x){return el('option',{value:x.id},x.name); })));
            typeSelect.value=ui.issueTypeId||'';
            typeSelect.addEventListener('change',function(){ui.issueTypeId=typeSelect.value;ui.fields={};loadOptions(ui.projectId,ui.issueTypeId).then(redraw).catch(function(e){ui.error=e.message;redraw();});});
            box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Issue type'),typeSelect));
          }
          if(ui.provider==='linear'&&ui.options&&ui.options.team){
            var projects=ui.options.team.projects?.nodes||[];
            if(projects.length){var ps=el('select',{'aria-label':'Linear project'},[el('option',{value:''},'No project')].concat(projects.map(function(x){return el('option',{value:x.id},x.name);})));ps.value=ui.projectId2||'';ps.addEventListener('change',function(){ui.projectId2=ps.value;});box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Project (optional)'),ps));}
          }
          if(ui.provider==='linear'&&ui.projectId&&!ui.options){box.appendChild(el('p',{class:'m'},'Loading team fields…'));}
          if(ui.provider==='jira'&&ui.issueTypeId&&(!ui.options||!ui.options.fields)){box.appendChild(el('p',{class:'m'},'Loading required fields…'));}
          if(ui.options&&(ui.provider==='linear'?ui.options.team:ui.options.fields)){
            var titleCfg=templateField('title');
            if(!ui.template||titleCfg){
              var titleInput=el('input',{type:'text',maxlength:'500',value:ui.title,'aria-label':'Issue title'});titleInput.required=titleCfg?!!titleCfg.required:true;titleInput.addEventListener('input',function(){ui.title=titleInput.value;ui.fields.title=titleInput.value;});
              box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Title'+(titleInput.required?' *':'')),titleInput));
            }
            var descCfg=templateField('description');
            if(!ui.template||descCfg){
              var descInput=el('textarea',{rows:'4','aria-label':'Issue description'});descInput.value=ui.description;descInput.required=!!(descCfg&&descCfg.required);descInput.addEventListener('input',function(){ui.description=descInput.value;ui.fields.description=descInput.value;});
              box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Description'+(descInput.required?' *':'')),descInput));
            }
            if(ui.provider==='linear'){
              var priorityCfg=templateField('priority');
              if(!ui.template||priorityCfg){
                var priority=el('select',{'aria-label':'Priority'},[['0','No priority'],['1','Urgent'],['2','High'],['3','Normal'],['4','Low']].map(function(x){return el('option',{value:x[0]},x[1]);}));priority.value=ui.priority;priority.required=!!(priorityCfg&&priorityCfg.required);priority.addEventListener('change',function(){ui.priority=priority.value;ui.fields.priority=priority.value;});
                box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Priority'+(priority.required?' *':'')),priority));
              }
              var stateCfg=templateField('stateId'),states=ui.options.team.states?.nodes||[];
              if(states.length&&(!ui.template||stateCfg)){var stateSelect=el('select',{'aria-label':'Initial status'},[el('option',{value:''},'Use team default')].concat(states.map(function(x){return el('option',{value:x.id},x.name);})));stateSelect.value=ui.stateId||'';stateSelect.required=!!(stateCfg&&stateCfg.required);stateSelect.addEventListener('change',function(){ui.stateId=stateSelect.value;ui.fields.stateId=stateSelect.value;});box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Initial status'+(stateSelect.required?' *':'')),stateSelect));}
              var labelsCfg=templateField('labelIds'),labels=ui.options.labels||[];
              if(labels.length&&(!ui.template||labelsCfg)){var labelSelect=el('select',{'aria-label':'Labels',multiple:'multiple'},labels.map(function(x){return el('option',{value:x.id},x.name);}));Array.from(labelSelect.options).forEach(function(o){o.selected=ui.labelIds.indexOf(o.value)>=0;});labelSelect.required=!!(labelsCfg&&labelsCfg.required);labelSelect.addEventListener('change',function(){ui.labelIds=Array.from(labelSelect.selectedOptions).map(function(o){return o.value;});ui.fields.labelIds=ui.labelIds;});box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Labels'+(labelSelect.required?' *':'')),labelSelect));}
              var assigneeCfg=templateField('assigneeId'),users=ui.options.users||[];
              if(users.length&&(!ui.template||assigneeCfg)){var assignee=el('select',{'aria-label':'Assignee'},[el('option',{value:''},'Unassigned')].concat(users.map(function(x){return el('option',{value:x.id},x.name||x.email||'User');})));assignee.value=ui.assigneeId||'';assignee.required=!!(assigneeCfg&&assigneeCfg.required);assignee.addEventListener('change',function(){ui.assigneeId=assignee.value;ui.fields.assigneeId=assignee.value;});box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Assignee'+(assignee.required?' *':'')),assignee));}
              var projectCfg=templateField('projectId2'),projects=ui.options.team.projects?.nodes||[];
              if(projects.length&&(!ui.template||projectCfg)){var ps=el('select',{'aria-label':'Linear project'},[el('option',{value:''},'No project')].concat(projects.map(function(x){return el('option',{value:x.id},x.name);})));ps.value=ui.projectId2||'';ps.required=!!(projectCfg&&projectCfg.required);ps.addEventListener('change',function(){ui.projectId2=ps.value;ui.fields.projectId2=ps.value;});box.appendChild(el('label',{class:'external-issue-field'},el('span',{},'Project'+(ps.required?' *':'')),ps));}
            }
            if(ui.provider==='jira'&&ui.options.fields){
              ui.options.fields.forEach(function(field){
                var cfg=templateField(field.id);if(ui.template&&!cfg)return;
                var val=ui.fields[field.id];if(field.type==='array'&&typeof val==='string')val=val.split(',').map(function(x){return x.trim();}).filter(Boolean);if(val===undefined){val=field.defaultValue&&typeof field.defaultValue==='object'?(field.defaultValue.id||field.defaultValue.name||''):(field.defaultValue||'');if(!val&&field.id==='priority'&&field.allowedValues&&field.allowedValues.length){var wanted=t.priority==='urgent'?/highest|urgent/i:t.priority==='high'?/^high/i:t.priority==='low'?/low/i:/medium|normal/i;var pickedPriority=field.allowedValues.filter(function(v){return wanted.test(v.name);})[0];if(pickedPriority)val=pickedPriority.id||pickedPriority.name;}}if(field.type==='array'&&typeof val==='string')val=val.split(',').map(function(x){return x.trim();}).filter(Boolean);if(field.id==='priority'&&typeof val==='string'&&field.allowedValues&&field.allowedValues.length&&!field.allowedValues.some(function(v){return String(v.id)===val||String(v.name).toLowerCase()===val.toLowerCase();})){var wanted=t.priority==='urgent'?/highest|urgent/i:t.priority==='high'?/^high/i:t.priority==='low'?/low/i:/medium|normal/i;var matched=field.allowedValues.filter(function(v){return wanted.test(v.name);})[0];if(matched){val=matched.id||matched.name;ui.fields[field.id]=val;}}
                var control;
                if(field.allowedValues&&field.allowedValues.length){
                  control=el('select',{'aria-label':field.name,'multiple':field.type==='array'},(field.type==='array'?[]:[el('option',{value:''},'— Select —')]).concat(field.allowedValues.map(function(v){return el('option',{value:v.id||v.name},v.name);})));
                  if(field.type==='array'&&Array.isArray(val))Array.from(control.options).forEach(function(o){o.selected=val.indexOf(o.value)>=0;});
                  else control.value=String(val);
                  control.addEventListener('change',function(){ui.fields[field.id]=field.type==='array'?Array.from(control.selectedOptions).map(function(o){return o.value;}):control.value;});
                }else{
                  control=el('input',{type:field.type==='number'?'number':field.type==='date'?'date':'text',value:val,'aria-label':field.name});
                  control.addEventListener('input',function(){ui.fields[field.id]=control.value;});
                }
                control.required=!!field.required||!!(cfg&&cfg.required);
                box.appendChild(el('label',{class:'external-issue-field'},el('span',{},field.name+(control.required?' *':'')),control));
              });
            }
            box.appendChild(el('button',{type:'button',class:'btn sm external-create-submit',onclick:createIssue},ui.busy?'Creating…':'Create and link issue'));
          }else if(ui.provider==='jira'&&!ui.issueTypeId&&ui.options)box.appendChild(el('p',{class:'m'},'Choose an issue type to load the fields required by this Jira project.'));
          else if(ui.provider==='linear'&&ui.projectId&&!ui.options)box.appendChild(el('p',{class:'m'},'Loading team fields…'));
        }
        return box;
      }
      cards.push(el('h3', {}, 'Service request approval'));
      if (ticketApprovals[t.number] === undefined) {
        ticketApprovals[t.number] = null;
        api('approval-get', { number: t.number }).then(function (r) { ticketApprovals[t.number] = r.ok ? r.body.approval : null; if (current && current.ticket.number === t.number) draw(); });
      }
      var ticketApproval = ticketApprovals[t.number];
      if (ticketApproval === null) cards.push(el('div', { class: 'pcard m' }, 'Checking approval status…'));
      else if (!ticketApproval) cards.push(el('div', { class: 'pcard m' }, 'No approval is required for this ticket.'));
      else {
        var myApproval = (ticketApproval.approver_ids || []).indexOf(meId) >= 0;
        var approvalStageIndex = Number(ticketApproval.current_stage) || 0, approvalStage = (ticketApproval.stages || [])[approvalStageIndex], hasResponded = (ticketApproval.decisions || []).some(function (d) { return Number(d.stageIndex || 0) === approvalStageIndex && d.approverId === meId; });
        var approvalComment = el('textarea', { rows: '2', maxlength: '2000', 'aria-label': 'Approval comment', placeholder: 'Add a decision comment (optional)…' });
        cards.push(el('div', { class: 'pcard ticket-approval', 'data-ticket-approval': String(ticketApproval.id) },
          el('div', { class: 'approval-status-row' }, el('strong', {}, ticketApproval.title || 'Request approval'), el('span', { class: 'approval-status ' + ticketApproval.status }, cap(ticketApproval.status))),
          el('p', { class: 'm' }, (approvalStage && approvalStage.name ? approvalStage.name + ' · ' : '') + (ticketApproval.mode === 'any' ? 'Any one approver' : 'All selected approvers') + ' · Stage ' + (approvalStageIndex + 1) + ' of ' + Math.max(1, (ticketApproval.stages || []).length) + ' · ' + (ticketApproval.approver_ids || []).length + ' approver(s)'),
          (ticketApproval.decisions || []).map(function (d) { var ag = agents.filter(function (a) { return a.id === d.approverId; })[0]; return el('div', { class: 'approval-decision ' + d.decision }, (ag ? ag.name || ag.email : 'Approver') + ' · ' + cap(d.decision) + (d.comment ? ' — ' + d.comment : '')); }),
          ticketApproval.status === 'pending' && myApproval && !hasResponded ? el('div', { class: 'approval-actions' }, approvalComment, el('div', { class: 'bar' },
            el('button', { type: 'button', class: 'btn', onclick: function () { api('approval-decide', { id: ticketApproval.id, decision: 'approved', comment: approvalComment.value }).then(function (r) { if (!r.ok) return say(r.body.error || 'Could not approve this request.', true); ticketApprovals[t.number] = undefined; open(t.number); say(r.body.status === 'approved' ? 'Request approved.' : 'Approval recorded.'); }); } }, 'Approve'),
            el('button', { type: 'button', class: 'btn danger', onclick: function () { if (!approvalComment.value.trim() && !root.confirm('Reject this request without a comment?')) return; api('approval-decide', { id: ticketApproval.id, decision: 'rejected', comment: approvalComment.value }).then(function (r) { if (!r.ok) return say(r.body.error || 'Could not reject this request.', true); ticketApprovals[t.number] = undefined; open(t.number); say('Request rejected.'); }); } }, 'Reject'))) :
          ticketApproval.status === 'pending' && myApproval && hasResponded ? el('p', { class: 'm' }, 'Your decision has been recorded.') : null));
      }
      cards.push(el('h3', {}, 'Fulfillment tasks'));
      if (ticketTasks[t.number] === undefined) {
        ticketTasks[t.number] = null;
        api('tasks-list', { number: t.number }).then(function (r) { ticketTasks[t.number] = r.ok ? (r.body.tasks || []) : []; if (current && current.ticket.number === t.number) draw(); });
      }
      var tasks = ticketTasks[t.number];
      if (tasks === null) cards.push(el('div', { class: 'pcard m' }, 'Loading fulfillment tasks…'));
      else if (!tasks || !tasks.length) cards.push(el('div', { class: 'pcard m' }, 'No fulfillment tasks are attached to this request.'));
      else cards.push(el('div', { class: 'pcard fulfillment-list' }, tasks.map(function (task) {
        var assignee = agents.filter(function (a) { return a.id === task.assignee_id; })[0];
        var status = sel('Task status', task.status, [['open','Open'],['in_progress','In progress'],['done','Done'],['cancelled','Cancelled']], function (v) {
          api('task-update', { id: task.id, status: v }).then(function (r) { if (!r.ok) return say(r.body.error || 'Could not update task.', true); ticketTasks[t.number] = null; open(t.number); });
        });
        return el('div', { class: 'fulfillment-task', 'data-task': String(task.id) }, el('div', { class: 'fulfillment-task-copy' }, el('strong', {}, task.title), task.description ? el('p', { class: 'm' }, task.description) : null, el('span', { class: 'm' }, assignee ? 'Assigned to ' + (assignee.name || assignee.email) : 'Unassigned')), status);
      })));
      cards.push(el('h3', {}, 'External issues'));
      cards.push(has('integrations')?externalIssuePanel():el('div',{class:'pcard'},lock('integrations')));

      cards.push(el('h3', {}, 'Side conversations'));
      if (!has('side_conversations')) cards.push(el('div', { class: 'pcard' }, lock('side_conversations')));
      else {
        x.sides.forEach(function (s) {
          var rep = el('textarea', { 'aria-label': 'Reply in the side conversation', placeholder: 'Reply to ' + s.to_email });
          cards.push(el('div', { class: 'side-c', 'data-side': String(s.id) }, el('strong', {}, s.subject), el('div', { class: 'm' }, s.to_email + (s.status === 'closed' ? ' · closed' : '')), s.messages.map(function (m) { return el('div', { class: 'sm-msg ' + m.direction }, el('b', {}, m.direction === 'in' ? s.to_email : m.author_name), ': ' + m.body); }),
            s.status === 'open' ? el('div', {}, rep, el('button', { type: 'button', class: 'btn l sm', 'data-side-reply': String(s.id), onclick: function () { act('side-send', { sideId: s.id, body: rep.value }); } }, 'Send'), ' ', el('button', { type: 'button', class: 'btn l sm', 'data-side-close': String(s.id), onclick: function () { act('side-close', { sideId: s.id }); } }, 'Close')) : null));
        });
        var st = el('input', { 'aria-label': 'Side conversation to', placeholder: 'Their email address', type: 'email' }), ss = el('input', { 'aria-label': 'Side conversation subject', placeholder: 'Subject', maxlength: '200' }), sb = el('textarea', { 'aria-label': 'Side conversation message', placeholder: 'Ask someone outside your team, like a vendor. They reply by email and the answer appears here.' });
        cards.push(el('div', { class: 'side-c' }, st, ss, sb, el('button', { type: 'button', class: 'btn l sm', 'data-side-start': '1', onclick: function () { act('side-send', { to: st.value, subject: ss.value, body: sb.value }); } }, 'Start a side conversation')));
      }
      if (!has('translation')) { cards.push(el('h3', {}, 'Translation')); cards.push(el('div', { class: 'pcard' }, lock('translation'))); }
      if (x.followers.length) { cards.push(el('h3', {}, 'Followers')); cards.push(el('div', { class: 'pcard m' }, x.followers.map(function (f) { return el('div', {}, f.name || f.email); }))); }
      cards.push(el('h3', {}, 'Timeline')); cards.push(el('ul', { class: 'timeline' }, x.events.map(function (e) { return el('li', { 'data-event': e.kind }, el('b', {}, e.actor_name || 'Someone'), ' ' + e.detail + ' · ' + ago(e.created_at)); })));
      return el('div', { class: 'ticket' }, props, center, el('aside', { class: 'col info', 'aria-label': 'Requester and context' }, cards));
    }
    // translation happens in the browser (Chrome's on-device translator): the text never goes to a server
    function translate(m) {
      var T = root.Translator, D = root.LanguageDetector, target = String((root.navigator && root.navigator.language) || 'en').slice(0, 2).toLowerCase();
      if (!T) return say('Your browser cannot translate on the device. Chrome on a computer can; nothing is sent to a server.', true);
      var detect = D ? Promise.resolve(D.create()).then(function (d) { return d.detect(m.body); }).then(function (rs) { return rs && rs[0] && rs[0].detectedLanguage || 'en'; }) : Promise.resolve('en');
      return detect.then(function (src) {
        if (src === target) { translated[m.id] = { note: 'Already in ' + target + '.', text: '' }; return draw(); }
        return Promise.resolve(T.create({ sourceLanguage: src, targetLanguage: target })).then(function (t) { return t.translate(m.body); }).then(function (out) { translated[m.id] = { note: 'Translated from ' + src + ' to ' + target + ' on this device.', text: String(out) }; draw(); });
      }).catch(function () { say('That message could not be translated here.', true); });
    }
    // reports
    function loadReport() { return api('report', { days: reportDays }).then(function (r) { if (r.status === 402) { closePanes(); report = { locked: true }; return draw(); } if (!r.ok) return say(r.body.error, true); closePanes(); report = r.body; draw(); }); }
    function hlist(title, rows) { var max = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.n; }))); return el('div', { class: 'rcard' }, el('h3', {}, title), rows.length ? rows.map(function (r) { return el('div', { class: 'hbar' }, el('span', { class: 'hn' }, cap(r.name)), el('span', { class: 'ht' }, el('span', { class: 'hf', style: 'width:' + Math.max(2, Math.round(100 * r.n / max)) + '%' })), el('span', { class: 'hv' }, String(r.n))); }) : el('p', { class: 'm' }, 'Nothing yet.')); }
    function homePane() {
      if (!dash) return el('div', { class: 'page wide' }, el('h2', {}, 'Dashboard'), el('p', { class: 'm' }, 'Loading…'));
      var c = dash.counts, first = (meName || '').split(' ')[0] || 'there', hr = new Date().getHours(), hello = (hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening') + ', ' + first;
      var go = function (f) { return function () { closePanes(); filter = f; refresh(); }; };
      var stat = function (label, value, f, data) { var b = el('button', { type: 'button', class: 'stat link', onclick: go(f) }, el('div', { class: 'sv' }, String(value)), el('div', { class: 'sl' }, label)); b.setAttribute(data, '1'); return b; };
      var cards = [stat('Open', c.open, { status: 'open', assignee: '', q: '' }, 'data-stat-open'), stat('Pending', c.pending, { status: 'pending', assignee: '', q: '' }, 'data-stat-pending'), stat('On hold', c.on_hold, { status: 'on_hold', assignee: '', q: '' }, 'data-stat-on-hold'), stat('Unassigned', c.unassigned, { status: 'active', assignee: 'none', q: '' }, 'data-stat-unassigned'), stat('Assigned to me', c.mine, { status: 'active', assignee: 'me', q: '' }, 'data-stat-mine'),
        el('div', { class: 'stat' }, el('div', { class: 'sv' }, String(c.newToday)), el('div', { class: 'sl' }, 'New today')), el('div', { class: 'stat' }, el('div', { class: 'sv' }, String(c.solvedToday)), el('div', { class: 'sl' }, 'Solved today'), el('div', { class: 'm' }, c.solvedWeek + ' this week'))];
      if (c.breached !== null && c.breached !== undefined) cards.push(stat('SLA breached', c.breached, { status: '', assignee: '', q: '', sla: 'breached' }, 'data-stat-breached'));
      var list = function (title, rows, empty, data) {
        var box = el('div', { class: 'pcard' }, el('h3', {}, title)); box.setAttribute(data, '1');
        if (!rows.length) box.appendChild(el('p', { class: 'm' }, empty));
        rows.forEach(function (t) { box.appendChild(el('button', { type: 'button', class: 'hrow', 'data-open': String(t.number), onclick: function () { open(t.number); } }, el('span', { class: 'grow' }, '#' + t.number + ' ' + t.subject), el('span', { class: 'm' }, t.requester + ' · ' + ago(t.updatedAt)))); });
        return box;
      };
      var st = dash.setup, steps = [[st.inbox, 'Set up your support email address', function () { api('mail-get').then(function (r) { if (!r.ok) return say(r.body.error, true); closePanes(); settings = r.body; draw(); }); }], [st.articles, 'Write your first help article', loadArticles], [st.team, 'Invite a teammate', function () { location_go('/app.html'); }], [st.firstTicket, 'Create a test ticket', function () { closePanes(); creating = true; draw(); }]];
      var todo = steps.filter(function (x) { return !x[0]; }), setup = null;
      if (todo.length) { setup = el('div', { class: 'pcard', 'data-setup': '1' }, el('h3', {}, 'Finish setting up (' + (steps.length - todo.length) + ' of ' + steps.length + ' done)')); todo.forEach(function (x) { setup.appendChild(el('button', { type: 'button', class: 'hrow', onclick: x[2] }, el('span', { class: 'grow' }, x[1]), el('span', { class: 'm' }, 'Go →'))); }); }
      return el('div', { class: 'page wide' }, el('div', { class: 'bar' }, el('h2', {}, hello), el('span', { class: 'grow' }), el('button', { type: 'button', class: 'btn', 'data-new-home': '1', onclick: function () { closePanes(); creating = true; draw(); } }, 'New ticket')),
        el('div', { class: 'stats' }, cards), dash.portal ? el('div', { class: 'pcard', 'data-portal': '1' }, el('h3', {}, 'Your customer portal and help center'), el('p', {}, el('a', { href: dash.portal, target: '_blank', rel: 'noopener' }, dash.portal.replace('https://', '')), ' · share this address with your customers.')) : null, setup, el('div', { class: 'rgrid' }, list('Assigned to you', dash.mine, 'Nothing is waiting on you.', 'data-list-mine'), list('Needs an owner', dash.unassigned, 'Every active ticket has an owner.', 'data-list-unassigned')));
    }
    function location_go(u) { nav.go(u); }
    function reportPane() {
      if (report.locked) return el('div', { class: 'page' }, el('h2', {}, 'Reports'), el('div', { class: 'pcard' }, el('p', {}, 'See volume, response times, who solved what and SLA results, and download the tickets as a spreadsheet.'), lock('reports')));
      var r = report, top = Math.max.apply(null, [1].concat(r.perDay.map(function (d) { return Math.max(d.created, d.solved); })));
      var stat = function (label, value, sub) { return el('div', { class: 'stat' }, el('div', { class: 'sv' }, value), el('div', { class: 'sl' }, label), sub ? el('div', { class: 'm' }, sub) : null); };
      var range = sel('Report range', String(reportDays), [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']], function (v) { reportDays = Number(v); loadReport(); });
      var chart = el('div', { class: 'chart', role: 'img', 'aria-label': 'Tickets created and solved per day: ' + r.perDay.reduce(function (a, d) { return a + d.created; }, 0) + ' created, ' + r.perDay.reduce(function (a, d) { return a + d.solved; }, 0) + ' solved' }, r.perDay.map(function (d) { return el('span', { class: 'day', title: d.day + ': ' + d.created + ' created, ' + d.solved + ' solved' }, el('i', { class: 'c', style: 'height:' + Math.round(100 * d.created / top) + '%' }), el('i', { class: 's', style: 'height:' + Math.round(100 * d.solved / top) + '%' })); }));
      return el('div', { class: 'page wide' }, el('div', { class: 'bar' }, el('h2', {}, 'Reports'), el('span', { class: 'grow' }), range, el('button', { type: 'button', class: 'btn l', 'data-report-csv': '1', onclick: function () { api('report-csv', { days: reportDays }).then(function (x) { if (!x.ok) return say(x.body.error, true); var u = root.URL.createObjectURL(new root.Blob([x.body.csv], { type: 'text/csv' })), a = doc.createElement('a'); a.href = u; a.download = x.body.filename; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { root.URL.revokeObjectURL(u); }, 1000); }); } }, 'Download CSV')),
        el('div', { class: 'stats' }, stat('Tickets created', String(r.total), r.truncated ? 'Showing the latest 5,000' : ''), stat('Customer satisfaction', r.csat && r.csat.rate !== null ? r.csat.rate + '%' : 'No ratings yet', r.csat ? r.csat.good + ' good of ' + r.csat.rated + ' rated · ' + r.csat.sent + ' asked' : ''), stat('First reply, average', minsText(r.firstReply.avgMin), 'median ' + minsText(r.firstReply.medianMin) + ' · ' + r.firstReply.answered + ' answered'), stat('Time to solve, average', minsText(r.resolution.avgMin), 'median ' + minsText(r.resolution.medianMin) + ' · ' + r.resolution.solved + ' solved'), r.sla ? stat('SLA met', r.sla.rate === null ? '—' : r.sla.rate + '%', r.sla.breached + ' breached or missed') : null),
        el('div', { class: 'rcard' }, el('h3', {}, 'Created and solved per day'), chart, el('div', { class: 'legend m' }, el('span', { class: 'k c' }), ' Created ', el('span', { class: 'k s' }), ' Solved')),
        el('div', { class: 'rgrid' }, hlist('By status', r.byStatus), hlist('By priority', r.byPriority), hlist('By channel', r.byChannel), hlist('By type', r.byType), hlist('By queue', r.byQueue), hlist('Solved by', r.solvedBy), hlist('Busiest labels', r.labels)));
    }
    function field(k, ph) { return el('input', { 'aria-label': k, placeholder: ph, maxlength: '200' }); }
    var blankNew = function () { return { subject: '', requesterName: '', requesterEmail: '', body: '', firstKind: 'agent', status: 'open', assigneeId: '', queueId: '', clientId: '', type: 'question', priority: 'normal', tags: '', cc: '', follow: false, custom: {} }; };
    var newf = blankNew();
    // the New ticket form: properties on the left, the subject and the first message on the right, and a choice of how it is sent
    function newPane() {
      var inp = function (key, label, ph, type) { var i = el('input', { 'aria-label': label || key, placeholder: ph || '', maxlength: '200', type: type || 'text' }); i.value = newf[key]; i.addEventListener('input', function () { newf[key] = i.value; }); return i; };
      var f = { subject: inp('subject', 'subject', 'Subject'), requesterName: inp('requesterName', 'requesterName', 'Name (optional)'), requesterEmail: inp('requesterEmail', 'requesterEmail', 'name@example.com', 'email') };
      f.subject.className = 'newsubj'; f.subject.setAttribute('maxlength', '200');
      var kk = { agent: ['Public reply', 'placeholder-agent'], note: ['Internal note', ''], requester: ['Customer message', ''] };
      var PH = { agent: 'Write the first reply. The requester is emailed.', note: 'Write an internal note. Only your team sees it.', requester: 'What is the request? Paste a picture here or attach files.' };
      var body = el('textarea', { 'aria-label': 'First message', placeholder: PH[newf.firstKind] }); body.value = newf.body;
      body.addEventListener('input', function () { newf.body = body.value; }); body.addEventListener('paste', pasteFiles(null)); var bodyBox = editor(body, null);
      var put = function (k) { return function (v) { newf[k] = v; }; };
      var reset = function () { newf = blankNew(); pending = []; };
      var tags = inp('tags', 'Labels', 'Labels, separated by commas'), cc = inp('cc', 'CC', 'Copy these people on replies');
      var dl = el('datalist', { id: 'dl-new-labels' }, labels.map(function (l) { return el('option', { value: l.name }); })); tags.setAttribute('list', 'dl-new-labels');
      var fieldIn = function (fd) {
        var v = newf.custom[fd.key], set = function (x) { newf.custom[fd.key] = x; };
        if (fd.type === 'dropdown') return sel(fd.label, v === undefined ? '' : String(v), [['', '—']].concat(fd.options.map(function (o) { return [o, o]; })), function (x) { if (x === '') delete newf.custom[fd.key]; else set(x); });
        if (fd.type === 'checkbox') { var cb = el('input', { type: 'checkbox', 'aria-label': fd.label, 'data-field': fd.key }); cb.checked = v === true; cb.addEventListener('change', function () { set(cb.checked); }); return cb; }
        var i = el('input', { type: fd.type === 'number' ? 'number' : fd.type === 'date' ? 'date' : 'text', 'aria-label': fd.label, 'data-field': fd.key, value: v === undefined ? '' : String(v), maxlength: '500' }); i.addEventListener('input', function () { if (i.value === '') delete newf.custom[fd.key]; else set(i.value); }); return i;
      };
      var follow = el('input', { type: 'checkbox', 'aria-label': 'Follow this ticket' }); follow.checked = !!newf.follow; follow.addEventListener('change', function () { newf.follow = follow.checked; });
      var side = el('aside', { class: 'col props newside', 'aria-label': 'New ticket properties' },
        prop('Requester', el('div', {}, f.requesterEmail, f.requesterName)),
        prop('Assignee', el('div', {}, sel('Assignee', newf.assigneeId, [['', 'Unassigned'], [meId, 'Me (take it)']].concat(agents.filter(function (a) { return a.id !== meId; }).map(function (a) { return [a.id, a.name || a.email]; })), put('assigneeId')))),
        prop('Followers', el('label', { class: 'chk' }, follow, ' Follow this ticket')),
        prop('Priority', sel('Priority', newf.priority, [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], put('priority'))),
        prop('Type', sel('Type', newf.type, [['question', 'Question'], ['incident', 'Incident'], ['problem', 'Problem'], ['task', 'Task']], put('type'))),
        has('queues') ? prop('Queue', sel('Queue', newf.queueId, [['', 'No queue']].concat(queues.map(function (q) { return [String(q.id), q.name]; })), put('queueId'))) : null,
        has('clients') ? prop('Client', sel('Client', newf.clientId, [['', 'No client']].concat(clients.map(function (k) { return [String(k.id), k.name]; })), put('clientId'))) : null,
        prop('Labels', el('div', {}, tags, dl)), prop('CC', cc),
        has('custom_fields') ? fields.map(function (fd) { return prop(fd.label, fieldIn(fd)); }) : null);
      var modeTab = function (k) { return el('button', { type: 'button', role: 'tab', 'data-new-kind': k, 'aria-selected': String(newf.firstKind === k), onclick: function () { newf.firstKind = k; if (k === 'requester') newf.status = newf.status; draw(); } }, kk[k][0]); };
      var macroSel = macros.length ? sel('Apply macro', '', [['', 'Apply macro']].concat(macros.map(function (m) { return [String(m.id), m.name]; })), function (v) { var m = macros.filter(function (y) { return String(y.id) === v; })[0]; if (!m) return; var first = String(newf.requesterName || '').split(' ')[0] || 'there'; newf.body = (newf.body ? newf.body + '\n\n' : '') + m.body.replace(/\{\{\s*name\s*\}\}/g, first).replace(/\{\{\s*agent\s*\}\}/g, meName); if (m.status) newf.status = m.status; if (m.priority) newf.priority = m.priority; if (m.add_tags) newf.tags = [newf.tags, m.add_tags].filter(Boolean).join(', '); draw(); }) : null;
      var statusSel = sel('Submit as', newf.status, [['open', 'Open'], ['pending', 'Pending'], ['on_hold', 'On hold'], ['solved', 'Solved']], function (v) { newf.status = v; draw(); });
      var submit = function () {
        var patch = { status: newf.status }; if (newf.assigneeId) patch.assigneeId = newf.assigneeId; if (newf.queueId) patch.queueId = newf.queueId; if (newf.clientId) patch.clientId = newf.clientId; if (newf.type !== 'question') patch.type = newf.type; if (newf.priority !== 'normal') patch.priority = newf.priority; if (newf.cc.trim()) patch.cc = newf.cc; if (Object.keys(newf.custom).length) patch.custom = newf.custom;
        if (newf.status === 'open') delete patch.status;
        api('create', { subject: f.subject.value, requesterName: f.requesterName.value, requesterEmail: f.requesterEmail.value, body: body.value, firstKind: newf.firstKind, tags: newf.tags, priority: newf.priority, patch: patch, follow: newf.follow, attachmentIds: pending.map(function (p) { return p.id; }) }).then(function (r) {
          if (!r.ok) return say(r.body.error, true); note = ''; var warn = r.body.warning; reset(); creating = false;
          return Promise.all([open(r.body.ticket.number), refresh(), loadInit()]).then(function () { if (warn) say('Created, but some properties were not saved: ' + warn, true); });
        });
      };
      var main1 = el('div', { class: 'col newmain' }, f.subject,
        el('div', { class: 'compose' }, el('div', { class: 'modes', role: 'tablist' }, modeTab('agent'), modeTab('note'), modeTab('requester'), macroSel), bodyBox, el('div', { class: 'bar' }, picker(null))),
        el('div', { class: 'bar newsubmit' }, el('button', { class: 'btn l', type: 'button', onclick: function () { pending.forEach(function (p) { api('delete-file', { id: p.id }); }); reset(); creating = false; draw(); } }, 'Cancel'), statusSel, el('button', { class: 'btn', type: 'button', 'data-create': '1', onclick: submit }, 'Submit as ' + cap(newf.status))));
      return el('div', { class: 'page newt' }, el('h2', {}, 'New ticket'), el('div', { class: 'newgrid' }, side, main1));
    }

    // ── Manage: queues, clients and macros ──
    // business hours for the SLA clock
    var DAYN = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
    function hoursPane() {
      var box = el('div', { class: 'pcard', 'data-hours': '1' }, el('h3', {}, 'Business hours'));
      if (!hoursCfg) { api('sla-hours-get').then(function (r) { hoursCfg = r.ok ? r.body.hours : { enabled: false, tz: 'UTC', schedule: {} }; draw(); }); box.appendChild(el('p', { class: 'm' }, 'Loading…')); return box; }
      var h = hoursCfg, on = el('input', { type: 'checkbox', 'aria-label': 'Count only business hours' }); on.checked = !!h.enabled;
      var tz = el('input', { 'aria-label': 'Time zone', value: h.tz && h.tz !== 'UTC' ? h.tz : (function () { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } })(), placeholder: 'America/Los_Angeles' });
      var rows = DAYN.map(function (d) { var x = h.schedule[d[0]] || {}, a = el('input', { type: 'time', 'aria-label': d[1] + ' opens', value: x.start || '' }), b = el('input', { type: 'time', 'aria-label': d[1] + ' closes', value: x.end || '' }); return { d: d[0], a: a, b: b, row: el('div', { class: 'bar' }, el('span', { style: 'width:90px' }, d[1]), a, ' to ', b) }; });
      box.appendChild(el('p', { class: 'm' }, 'When this is on, the SLA clock only runs during these hours in this time zone, so a ticket that comes in on Friday evening is not late on Saturday. Leave a day blank for closed.'));
      box.appendChild(el('label', { class: 'm' }, on, ' Count only business hours')); box.appendChild(el('div', { class: 'bar' }, tz));
      rows.forEach(function (r) { box.appendChild(r.row); });
      if (isAdmin) box.appendChild(el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-hours-save': '1', onclick: function () { var sch = {}; rows.forEach(function (r) { if (r.a.value || r.b.value) sch[r.d] = { start: r.a.value, end: r.b.value }; }); api('sla-hours-save', { enabled: on.checked, tz: tz.value.trim(), schedule: sch }).then(function (r) { if (!r.ok) return say(r.body.error, true); hoursCfg = r.body.hours; say(on.checked ? 'Business hours saved. SLA clocks now count only these hours.' : 'Business hours are off: SLA clocks run around the clock.'); }); } }, 'Save business hours')));
      return box;
    }
    var RULE_FIELDS = { priority: ['is', 'is_not'], status: ['is', 'is_not'], channel: ['is', 'is_not'], type: ['is', 'is_not'], tag: ['is', 'is_not'], subject: ['contains'], message: ['contains'], sender_domain: ['is'], hours_idle: ['gte'] };
    var RULE_ENUM = { priority: ['low', 'normal', 'high', 'urgent'], status: ['open', 'pending', 'on_hold', 'solved', 'closed'], channel: ['web', 'email', 'api', 'portal', 'chat', 'whatsapp'], type: ['question', 'incident', 'problem', 'task'] };
    var RULE_ACTIONS = [['set_priority', 'Set priority'], ['set_status', 'Set status'], ['set_type', 'Set type'], ['add_tag', 'Add label'], ['assign', 'Assign to'], ['set_queue', 'Move to queue'], ['add_note', 'Add internal note'], ['auto_reply', 'Send public reply']];
    function ruleEditor() {
      var again = function () { draw(); };
      var txt = function (label, value, on, ph) { var i = el('input', { 'aria-label': label, value: value || '', placeholder: ph || '', maxlength: '2000' }); i.addEventListener('input', function () { on(i.value); }); return i; };
      var name = txt('Rule name', rd.name, function (v) { rd.name = v; }, 'Rule name, for example Refunds are urgent');
      var ev = sel('When', rd.event, [['created', 'When a ticket is created'], ['customer_reply', 'When the customer replies'], ['time', 'Every hour, for idle tickets']], function (v) { rd.event = v; if (v === 'time' && !rd.conditions.some(function (c) { return c.field === 'hours_idle'; })) rd.conditions.push({ field: 'hours_idle', op: 'gte', value: '168' }); again(); });
      var conds = rd.conditions.map(function (c, i) {
        var f = sel('Condition field', c.field, Object.keys(RULE_FIELDS).map(function (k) { return [k, k.replace('_', ' ')]; }), function (v) { c.field = v; c.op = RULE_FIELDS[v][0]; c.value = RULE_ENUM[v] ? RULE_ENUM[v][0] : ''; again(); });
        var o = sel('Condition operator', c.op, RULE_FIELDS[c.field].map(function (x) { return [x, x.replace('_', ' ')]; }), function (v) { c.op = v; });
        var v = RULE_ENUM[c.field] ? sel('Condition value', c.value, RULE_ENUM[c.field].map(function (x) { return [x, x]; }), function (x) { c.value = x; }) : txt('Condition value', c.value, function (x) { c.value = x; }, c.field === 'hours_idle' ? 'hours' : 'text');
        return el('div', { class: 'bar', 'data-cond': String(i) }, f, o, v, el('button', { type: 'button', class: 'btn l sm', 'aria-label': 'Remove condition', onclick: function () { rd.conditions.splice(i, 1); again(); } }, '×'));
      });
      var acts = rd.actions.map(function (a, i) {
        var t = sel('Action', a.type, RULE_ACTIONS, function (v) { a.type = v; a.value = ''; again(); });
        var v = RULE_ENUM[a.type.replace('set_', '')] ? sel('Action value', a.value, [['', 'Choose…']].concat(RULE_ENUM[a.type.replace('set_', '')].map(function (x) { return [x, x]; })), function (x) { a.value = x; })
          : a.type === 'assign' ? sel('Action value', a.value, [['', 'Choose…'], ['none', 'Nobody']].concat([['round_robin', 'Next available agent']].concat(agents.map(function (x) { return [x.id, x.name || x.email]; }))), function (x) { a.value = x; })
          : a.type === 'set_queue' ? sel('Action value', a.value, [['', 'Choose…'], ['none', 'No queue']].concat(queues.map(function (x) { return [String(x.id), x.name]; })), function (x) { a.value = x; })
          : a.type === 'auto_reply' ? (function() {
              var rich = root.EffArticleEditor ? root.EffArticleEditor.create(doc, { html: a.value || '', canSource: has('article_import'), canImport: false, hideImport: true, hideVideo: true, emailMode: true, say: say, upload: uploadHelpImage }) : null;
              var box = el('div', { style: 'width:100%;margin-top:8px;margin-bottom:8px;' },
                el('p', { class: 'm' }, 'Compose a formatted public reply or edit its HTML source. Variables such as {{name}}, {{ticket_number}} and {{ticket_subject}} are supported.'),
                rich ? rich.el : el('textarea', { 'aria-label': 'Action value', rows: '14', placeholder: 'Write the automated reply or paste HTML.' }));
              if (rich) {
                rich.area.addEventListener('input', function () { a.value = rich.getHtml(); });
                var source = rich.el.querySelector('.ae-src'); if (source) source.addEventListener('input', function () { a.value = source.value; });
                if (has('ai_assist')) {
                  var aiMode = sel('AI rewrite', '', [['', '✦ Rewrite with AI…'], ['friendlier', 'Friendlier'], ['shorter', 'Shorter'], ['clearer', 'Clearer'], ['formal', 'More formal'], ['fix', 'Fix spelling and grammar']], function (v) {
                    if (!v) return;
                    var text = htmlPlain(rich.getHtml()); if (!text) return say('Write a message first, then choose how to rewrite it.', true);
                    aiBusy = 'automation'; draw();
                    api('ai-rewrite', { mode: v, text: text }).then(function (r) { aiBusy = ''; if (!r.ok) return say(r.body.error || 'The AI could not answer.', true); rich.setHtml('<p>' + htmlEsc(r.body.text).replace(/\n/g, '<br>') + '</p>'); a.value = rich.getHtml(); draw(); });
                  });
                  box.insertBefore(el('div', { class: 'bar', style: 'margin:6px 0;' }, aiMode, el('span', { class: 'm' }, 'AI tools are included with Suite and Pro. Review the result before saving.')), rich.el);
                }
              } else { var ta = box.querySelector('textarea'); ta.value = a.value || ''; ta.addEventListener('input', function () { a.value = ta.value; }); }
              return box;
          })()
          : txt('Action value', a.value, function (x) { a.value = x; }, a.type === 'add_tag' ? 'label' : 'text');
        
        var isRich = a.type === 'auto_reply';
        return el('div', { class: 'bar', 'data-act': String(i), style: isRich ? 'flex-wrap: wrap; align-items: flex-start;' : '' }, 
            t, 
            el('div', { style: isRich ? 'flex: 1 1 100%;' : 'flex: 1;' }, v), 
            el('button', { type: 'button', class: 'btn l sm', 'aria-label': 'Remove action', onclick: function () { rd.actions.splice(i, 1); again(); } }, '×')
        );
      }); // <-- This closing bracket was missing!
      
      var once = el('input', { type: 'checkbox', 'aria-label': 'Run once per ticket' }); once.checked = rd.once !== false; once.addEventListener('change', function () { rd.once = once.checked; });
      var on = el('input', { type: 'checkbox', 'aria-label': 'Rule is on' }); on.checked = rd.active !== false; on.addEventListener('change', function () { rd.active = on.checked; });
      return el('div', { class: 'mlist' }, el('div', { class: 'page', style: 'padding:12px 0' }, name, ev,
        el('h3', {}, 'If all of these are true'), conds, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn l sm', 'data-cond-add': '1', onclick: function () { if (rd.conditions.length < 8) rd.conditions.push({ field: 'priority', op: 'is', value: 'normal' }); again(); } }, 'Add condition')),
        el('h3', {}, 'Then do'), acts, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn l sm', 'data-act-add': '1', onclick: function () { if (rd.actions.length < 6) rd.actions.push({ type: 'add_tag', value: '' }); again(); } }, 'Add action')),
        el('label', { class: 'm' }, once, ' Run only once per ticket'), el('label', { class: 'm' }, on, ' Rule is on'),
        el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-rule-save': '1', onclick: function () { api('rule-save', rd).then(function (r) { if (!r.ok) return say(r.body.error, true); rd = null; rules = null; say('Automation saved.'); }); } }, 'Save automation'), el('button', { type: 'button', class: 'btn l', onclick: function () { rd = null; again(); } }, 'Cancel'))));
    }
    function managePane() {
      // the settings are grouped by what they are for; each entry: id, name, what it does, the plan feature it needs (if any)
      var groups = [
        ['Agents and access', [['team', 'Agents', 'Your team: roles, permissions, recent activity and tickets.'], ['sso', 'Single sign-on', 'Let people sign in with your company identity provider.', 'sso'], ['roles', 'Custom roles', 'Decide exactly what each agent may change.', 'custom_roles'], ['support', 'Support visits', 'See when EffDesk support looked at this workspace.']]],
        ['Tickets', [['routing', 'Routing', 'Hand new tickets to the right agent automatically.', 'routing'], ['queues', 'Queues', 'Split work between teams and send tickets to the right one.', 'queues'], ['statuses', 'Ticket statuses', 'Add your own statuses, like Waiting on vendor.', 'queues'], ['helplook', 'Help center look', 'Pick a theme, colours and the headline of your help center.', 'help_center_basic'], ['wstatus', 'Status page', 'A public page where your customers see outages and planned work.', 'queues'], ['fields', 'Ticket fields', 'Add your own fields to every ticket.', 'custom_fields'], ['macros', 'Macros', 'Saved replies that also set status, priority and labels.'], ['triggers', 'Automations', 'Rules that act on tickets by themselves.', 'triggers'], ['sla', 'SLA and hours', 'Reply and solve targets, and business hours.', 'sla']]],
        ['Customers', [['contacts', 'Contacts', 'Requester profiles, contact details and company relationships.', 'clients'], ['clients', 'Companies', 'Manage the companies your customers belong to.', 'clients']]],
        ['Channels', [['helpwidget', 'Help center and search widget', 'Your public help center, request page and a search box for your website.'], ['forms', 'Request forms', 'Forms customers fill in on the help center.', 'request_forms'], ['chat', 'Live chat', 'A chat button for your website.', 'live_chat'], ['whatsapp', 'WhatsApp', 'Answer customers who message your WhatsApp number.', 'whatsapp']]],
        ['Data and compliance', [['migrate', 'Import from Zendesk or Freshdesk', 'Bring your tickets and help articles over. Customers are not emailed.'], ['audit', 'Audit log', 'Who changed what, and when.', 'audit_log'], ['export', 'Export your data', 'Download your tickets, clients, macros and articles.', 'data_export']]],
        ['Developers', [['integrations', 'Webhooks', 'Manage Slack, Microsoft Teams and outbound webhooks.'], ['api', 'API', 'Tokens for your own systems.', 'api']]]
      ];
      var flat = []; groups.forEach(function (g) { g[1].forEach(function (t) { if (!(support && t[0] === 'support')) flat.push(t); }); });
      var cur = flat.filter(function (t) { return t[0] === manage; })[0] || flat[0];
      var head = el('nav', { class: 'mnav', 'aria-label': 'Manage' }, groups.map(function (g) {
        var items = g[1].filter(function (t) { return !(support && t[0] === 'support'); }); if (!items.length) return null;
        var open1 = !mClosed[g[0]];
        return el('div', { class: 'mgroup' }, el('button', { type: 'button', class: 'mgh', 'data-group': g[0], 'aria-expanded': String(open1), onclick: function () { mClosed[g[0]] = open1; draw(); } }, el('span', {}, g[0]), el('span', { class: 'chev', 'aria-hidden': 'true' }, open1 ? '▾' : '▸')), !open1 ? null : items.map(function (t) {
          var locked = t[3] && !has(t[3]);
          return el('button', { type: 'button', class: 'mnav-i', 'data-manage-tab': t[0], 'aria-current': String(manage === t[0]), onclick: function () { manage = t[0]; mEdit = null; if(t[0]==='contacts'){contactProfile=null;contactRows=null;} mDetail = true; draw(); if(t[0]==='contacts')loadContacts(); } }, el('span', {}, t[1]), locked ? el('span', { class: 'mplan' }, PLAN_OF[t[3]] || 'Upgrade') : null);
        }));
      }));
      var body, afterSave = function (msg) { return loadInit().then(function () { mEdit = null; say(msg); }); };
      var guardAdmin = !isAdmin ? el('p', { class: 'm' }, 'Only an owner or an admin can change these.') : null;
      if (manage === 'contacts') {
        if(!has('clients')) body=lock('clients');
        else if(contactProfile){
          var cp=contactProfile.contact||{},cpTickets=contactProfile.tickets||[];
          var nm=el('input',{value:cp.name||'',maxlength:'100','aria-label':'Contact name'}),em=el('input',{type:'email',value:cp.email||'',disabled:true,'aria-label':'Contact email'}),ph=el('input',{value:cp.phone||'',maxlength:'60','aria-label':'Phone'}),ttl=el('input',{value:cp.title||'',maxlength:'100','aria-label':'Job title'}),co=el('select',{'aria-label':'Company'},[el('option',{value:''},'No company')].concat(clients.map(function(k){return el('option',{value:String(k.id)},k.name+(k.domain?' · '+k.domain:''));}))),nt=el('textarea',{rows:'4','aria-label':'Internal contact notes',placeholder:'Internal notes about this contact'});co.value=cp.company_id?String(cp.company_id):'';nt.value=cp.notes||'';
          body=el('div',{class:'contact-workspace'},el('div',{class:'contact-page-head'},el('button',{type:'button',class:'btn l sm',onclick:function(){contactProfile=null;contactRows=null;loadContacts();draw();}},'← All contacts'),el('span',{class:'contact-record-type'},'CONTACT PROFILE')),
            el('div',{class:'contact-profile-card'},el('div',{class:'contact-avatar'},initial(cp.name||cp.email)),el('div',{},el('h2',{},cp.name||cp.email),el('p',{class:'m'},cp.email+(cp.company_name?' · '+cp.company_name:'')))),
            el('div',{class:'contact-form-grid'},el('label',{},'Full name',nm),el('label',{},'Email address',em),el('label',{},'Phone',ph),el('label',{},'Job title',ttl),el('label',{},'Company',co),el('label',{class:'contact-notes'},'Internal notes',nt)),
            el('div',{class:'bar'},el('button',{type:'button',class:'btn',onclick:function(){api('contact-save',{email:cp.email,name:nm.value,phone:ph.value,title:ttl.value,companyId:co.value||null,notes:nt.value}).then(function(r){if(!r.ok)return say(r.body.error,true);return api('contact-get',{email:cp.email}).then(function(x){if(x.ok)contactProfile=x.body;say('Contact saved.');draw();});});}},'Save contact'),el('span',{class:'m'},'Last seen '+(cp.last_seen_at?new Date(cp.last_seen_at).toLocaleDateString():'—'))),
            el('h3',{},'Recent tickets'),cpTickets.length?el('div',{class:'contact-ticket-list'},cpTickets.map(function(tk){return el('button',{type:'button',class:'contact-ticket-row',onclick:function(){open(tk.number);}},el('strong',{},'#'+tk.number+' '+tk.subject),el('span',{class:'badge s-'+tk.status},cap(tk.status)),el('small',{},'Updated '+new Date(tk.updated_at).toLocaleDateString()));})):el('p',{class:'m'},'No tickets have been associated with this contact yet.'));
        }else{
          if(contactRows===null){loadContacts();body=el('p',{class:'m'},'Loading contacts…');}
          else{
            var cs=el('input',{type:'search',value:contactSearch,placeholder:'Search contacts by name, email or company…','aria-label':'Search contacts'});cs.addEventListener('input',function(){contactSearch=cs.value;root.clearTimeout(contactTimer);contactTimer=root.setTimeout(loadContacts,180);});
            body=el('div',{class:'contact-workspace'},el('div',{class:'contact-page-head'},el('div',{},el('h2',{},'Contacts'),el('p',{class:'m'},'Every requester gets a profile automatically when they submit a ticket.')),el('span',{class:'contact-record-type'},contactRows.length+' CONTACTS')),
              el('div',{class:'contact-toolbar'},cs,el('button',{type:'button',class:'btn',onclick:function(){var address=root.prompt('Contact email address');if(!address)return;openContact(address.trim());}},'+ Add contact')),
              el('div',{class:'contact-list'},contactRows.map(function(p){return el('button',{type:'button',class:'contact-list-row',onclick:function(){openContact(p.email);}},el('span',{class:'contact-avatar sm'},initial(p.name||p.email)),el('span',{class:'contact-list-copy'},el('strong',{},p.name||p.email),el('span',{class:'m'},p.email),el('small',{},(p.company_name||'No company')+' · '+p.tickets+' tickets')),el('span',{class:'contact-list-arrow'},'›'));})),
              !contactRows.length?el('p',{class:'m'},'No contacts yet. Requester profiles will appear here automatically as tickets arrive.'):null);
          }
        }
      } else if (manage === 'queues') {
        if (!has('queues')) body = lock('queues');
        else { var qn = el('input', { 'aria-label': 'Queue name', placeholder: 'Queue name, for example Billing', maxlength: '60', value: mEdit && mEdit.name || '' });
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Queues sort tickets by team or topic. Tickets can sit in one queue, and the Tickets tab filters by it.'), queues.map(function (q) { return el('div', { class: 'mitem', 'data-queue-item': String(q.id) }, el('span', { class: 't' }, q.name + ' · ' + q.active + ' active'), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = { id: q.id, name: q.name }; draw(); } }, 'Rename'), el('button', { type: 'button', class: 'btn l sm', 'data-queue-delete': String(q.id), onclick: function () { api('queue-delete', { id: q.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Queue deleted.'); }); } }, 'Delete')) : null); }),
            guardAdmin || el('div', { class: 'bar' }, qn, el('button', { type: 'button', class: 'btn', 'data-queue-save': '1', onclick: function () { api('queue-save', { id: mEdit && mEdit.id, name: qn.value }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Queue saved.'); }); } }, mEdit ? 'Save name' : 'Add queue'))); }
      } else if (manage === 'helplook') {
        if (!isAdmin) body = guardAdmin;
        else if (hlook === null) { api('help-settings-get').then(function (r) { hlook = r.ok ? r.body : { settings: { theme: 'classic', accent: '', hero_title: '', hero_subtitle: '' }, paid: false }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var hs = hlook.settings, HTHEMES = [['classic', 'Classic', '#e8890c', '#fff3de'], ['midnight', 'Midnight', '#6ea8ff', '#1d2e55'], ['mint', 'Mint', '#1f9d6b', '#d8f5e8'], ['aurora', 'Aurora', '#7c4dff', '#22c1c3'], ['sunset', 'Sunset', '#e4572e', '#c2185b'], ['forest', 'Forest', '#2e7d4f', '#163f29'], ['ocean', 'Ocean', '#0a78c2', '#12b5cb'], ['orchid', 'Orchid', '#b0399f', '#6a2c91'], ['obsidian', 'Obsidian', '#d4af37', '#0b0b0d'], ['champagne', 'Champagne', '#b8893a', '#e8cf9a']];
          var ht = el('input', { 'aria-label': 'Headline', placeholder: 'How can we help?', maxlength: '100', value: hs.hero_title || '' }), hsub = el('input', { 'aria-label': 'Subheading', placeholder: 'Search our articles or browse by topic.', maxlength: '200', value: hs.hero_subtitle || '' }), hac = el('input', { 'aria-label': 'Accent colour', placeholder: '#2f6fed', maxlength: '7', value: hs.accent || '' });
          var chosen = hs.theme;
          var swatches = HTHEMES.map(function (t) { var locked = t[0] !== 'classic' && !hlook.paid; return el('button', { type: 'button', class: 'swatch' + (t[0] === chosen ? ' on' : '') + (locked ? ' locked' : ''), 'data-help-theme': t[0], 'aria-pressed': t[0] === chosen ? 'true' : 'false', title: locked ? t[1] + ' is part of the Team plan' : t[1], onclick: function () { if (locked) return say(t[1] + ' is part of the Team plan. Classic is free.', true); chosen = t[0]; [].slice.call(body.querySelectorAll('[data-help-theme]')).forEach(function (b) { var on = b.getAttribute('data-help-theme') === chosen; b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.classList.toggle('on', on); }); } }, el('span', { class: 'sw', style: 'background:linear-gradient(135deg,' + t[3] + ',' + t[2] + ')' }), el('span', {}, t[1] + (locked ? ' · Team' : ''))); });
          body = el('div', { class: 'mlist', 'data-help-look': '1' }, el('p', { class: 'm' }, 'How your public help center looks. Classic is free; the other themes, a custom accent colour and your own headline come with the Team plan.'),
            el('div', { class: 'swatches' }, swatches), el('label', { class: 'fld' }, 'Headline', ht), el('label', { class: 'fld' }, 'Subheading', hsub), el('label', { class: 'fld' }, 'Accent colour (hex)', hac),
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-help-look-save': '1', onclick: function () { api('help-settings-save', { theme: chosen, accent: hac.value.trim(), heroTitle: ht.value, heroSubtitle: hsub.value }).then(function (r) { if (!r.ok) return noteFrom(r); hlook = null; return afterSave('Saved. Your help center has the new look.'); }); } }, 'Save'), el('a', { class: 'btn l', href: '/help/' + encodeURIComponent(slug), target: '_blank', rel: 'noopener' }, 'View the help center')));
        }
      } else if (manage === 'wstatus') {
        if (!has('queues')) body = lock('queues');
        else if (!isAdmin) body = guardAdmin;
        else if (wst === null) { api('wstatus-list').then(function (r) { wst = r.ok ? r.body : { components: [], incidents: [] }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var reload = function (msg) { return api('wstatus-list').then(function (r) { if (r.ok) wst = r.body; say(msg); }); }, fail2 = function (r) { return noteFrom(r); };
          var LV = [['operational', 'Operational'], ['degraded', 'Degraded performance'], ['partial_outage', 'Partial outage'], ['major_outage', 'Major outage'], ['maintenance', 'Under maintenance']], page = '/help/' + slug + '/status';
          var comps = wst.components.map(function (c) { var nm = el('input', { 'aria-label': 'System name', value: c.name, maxlength: '80' }), st = sel('System status', c.status, LV, function () { });
            return el('div', { class: 'mitem', 'data-wcomp': String(c.id) }, nm, st, el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { api('wstatus-component-save', { id: c.id, name: nm.value, description: c.description, status: st.value, position: c.position, visible: c.visible }).then(function (r) { if (!r.ok) return fail2(r); return reload('Saved.'); }); } }, 'Save'), el('button', { type: 'button', class: 'btn l sm', onclick: function () { api('wstatus-component-delete', { id: c.id }).then(function (r) { if (!r.ok) return fail2(r); return reload('Removed.'); }); } }, 'Delete'))); });
          var cn = el('input', { 'aria-label': 'New system name', placeholder: 'A system customers rely on, for example Customer portal', maxlength: '80' });
          var it = el('input', { 'aria-label': 'Incident title', placeholder: 'What is wrong, in plain words', maxlength: '140' }), ib = el('textarea', { 'aria-label': 'First update', rows: '3', placeholder: 'What you know and what happens next', maxlength: '4000' }), ii = sel('Impact', 'minor', [['minor', 'Minor: degraded'], ['major', 'Major: partial outage'], ['critical', 'Critical: major outage'], ['none', 'No impact']], function () { });
          var checks = wst.components.map(function (c) { var cb = el('input', { type: 'checkbox', value: String(c.id), 'aria-label': c.name }); return el('label', { class: 'chk' }, cb, ' ' + c.name); });
          var incs = wst.incidents.map(function (i) { var live = i.status !== 'resolved' && i.status !== 'completed'; var ub = el('input', { 'aria-label': 'Update text', placeholder: 'Write an update', maxlength: '4000' }), us = sel('New status', i.status, [['investigating', 'Investigating'], ['identified', 'Identified'], ['monitoring', 'Monitoring'], ['resolved', 'Resolved']], function () { });
            return el('div', { class: 'mitem col', 'data-wincident': String(i.id) }, el('span', { class: 't' }, i.title + ' · ' + i.status), live ? el('div', { class: 'bar' }, us, ub, el('button', { type: 'button', class: 'btn sm', 'data-wpost': String(i.id), onclick: function () { api('wstatus-incident-update', { id: i.id, status: us.value, body: ub.value }).then(function (r) { if (!r.ok) return fail2(r); return reload(us.value === 'resolved' ? 'Resolved.' : 'Update posted.'); }); } }, 'Post update')) : null, el('button', { type: 'button', class: 'btn l sm', onclick: function () { api('wstatus-incident-delete', { id: i.id }).then(function (r) { if (!r.ok) return fail2(r); return reload('Deleted.'); }); } }, 'Delete')); });
          body = el('div', { class: 'mlist', 'data-wstatus': '1' }, el('p', { class: 'm' }, 'Your own public status page, separate from EffDesk\u2019s. Customers see it at ', el('a', { href: page, target: '_blank', rel: 'noopener' }, page), ' and can follow the feed. It shows what you post here.'),
            el('h4', {}, 'Systems'), comps.length ? comps : el('p', { class: 'm' }, 'No systems yet. Add the things your customers depend on.'),
            el('div', { class: 'bar' }, cn, el('button', { type: 'button', class: 'btn', 'data-wcomp-add': '1', onclick: function () { api('wstatus-component-save', { name: cn.value, status: 'operational' }).then(function (r) { if (!r.ok) return fail2(r); return reload('System added.'); }); } }, 'Add system')),
            el('h4', {}, 'Post an incident'), it, ii, ib, el('div', { class: 'checks' }, checks),
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-wincident-post': '1', onclick: function () { var ids = [].slice.call(body.querySelectorAll('.checks input')).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); }); api('wstatus-incident-create', { title: it.value, impact: ii.value, body: ib.value, status: 'investigating', componentIds: ids }).then(function (r) { if (!r.ok) return fail2(r); return reload('Posted. It is on your status page now.'); }); } }, 'Post')),
            el('h4', {}, 'Incidents'), incs.length ? incs : el('p', { class: 'm' }, 'Nothing posted.')); }
      } else if (manage === 'statuses') {
        if (!has('queues')) body = lock('queues');
        else { var sn = el('input', { 'aria-label': 'Status name', placeholder: 'Status name, for example Waiting on vendor', maxlength: '40', value: mEdit && mEdit.name || '' }), sc = sel('Counts as', mEdit && mEdit.category || 'pending', [['open', 'Open'], ['pending', 'Pending'], ['on_hold', 'On hold'], ['solved', 'Solved'], ['closed', 'Closed']], function () { });
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Every status counts as one of the built-in statuses, so reports, reply deadlines and automations keep working. “Open”, “Pending” and “On hold” tickets are active; “Solved” and “Closed” are done.'),
            statuses.length ? statuses.map(function (x) { return el('div', { class: 'mitem', 'data-status-item': String(x.id) }, el('span', { class: 't' }, x.name + ' · counts as ' + x.category + ' · ' + x.tickets + ' ticket' + (x.tickets === 1 ? '' : 's')), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = { id: x.id, name: x.name, category: x.category }; draw(); } }, 'Edit'), el('button', { type: 'button', class: 'btn l sm', 'data-status-delete': String(x.id), onclick: function () { api('status-delete', { id: x.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Status deleted. Its tickets keep the built-in status they counted as.'); }); } }, 'Delete')) : null); }) : el('p', { class: 'm' }, 'No custom statuses yet. The four built-in ones are always there.'),
            guardAdmin || el('div', { class: 'bar' }, sn, sc, el('button', { type: 'button', class: 'btn', 'data-status-save': '1', onclick: function () { api('status-save', { id: mEdit && mEdit.id, name: sn.value, category: sc.value }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Status saved.'); }); } }, mEdit ? 'Save status' : 'Add status'))); }
      } else if (manage === 'clients') {
        if (!has('clients')) body = lock('clients');
        else { if(contactRows===null)loadContacts(); var e = mEdit || {}, cn = el('input', { 'aria-label': 'Company name', placeholder: 'Company name', maxlength: '100', value: e.name || '' }), cd = el('input', { 'aria-label': 'Company email domain', placeholder: 'Email domain, like acme.com (optional)', maxlength: '100', value: e.domain || '' }), cnotes=el('textarea',{rows:'3','aria-label':'Company internal notes',placeholder:'Internal notes about this company'});cnotes.value=e.notes||'';
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Companies group contacts and tickets. Add an email domain to associate new requesters from that domain automatically. You can also link contacts manually from their profiles.'), clients.map(function (k) { var linked=contactRows?(contactRows.filter(function(p){return String(p.company_id)===String(k.id);})):[];return el('div', { class: 'mitem company-item', 'data-client-item': String(k.id) }, el('span', { class: 't' }, k.name + (k.domain ? ' · @' + k.domain : '') + ' · ' + k.tickets + ' tickets',el('small',{class:'m'},linked.length+' linked contact(s) · '+(k.notes?'Has internal notes':'No notes yet')),linked.slice(0,4).map(function(p){return el('button',{type:'button',class:'company-contact-link',onclick:function(){openContact(p.email);}},p.name||p.email);})), el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = { id: k.id, name: k.name, domain: k.domain, notes:k.notes||'', shareTickets: k.share_tickets }; draw(); } }, 'Edit'), isAdmin ? el('button', { type: 'button', class: 'btn l sm', 'data-client-delete': String(k.id), onclick: function () { api('client-delete', { id: k.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Company deleted.'); }); } }, 'Delete') : null)); }),
            el('div', { class: 'bar' }, cn, cd, cnotes, el('button', { type: 'button', class: 'btn', 'data-client-save': '1', onclick: function () { api('client-save', { id: e.id, name: cn.value, domain: cd.value, notes:cnotes.value, shareTickets: !!e.shareTickets }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Company saved.'); }); } }, e.id ? 'Save company' : 'Add company'))); }
      } else if (manage === 'triggers') {
        if (!has('triggers')) body = lock('triggers');
        else if (!isAdmin) body = guardAdmin;
        else if (rules === null) { api('rules-list').then(function (r) { rules = r.ok ? r.body.rules : []; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else if (rd) body = ruleEditor();
        else {
          var EVN = { created: 'a ticket is created', customer_reply: 'the customer replies', time: 'every hour, for idle tickets' };
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'An automation does things for you: when something happens, and the ticket matches your conditions, it sets the priority, assigns an owner, adds a label, writes a note or sends a reply. Timed rules, such as closing tickets that were solved a week ago, are checked every hour.'),
            rules.map(function (x) { return el('div', { class: 'mitem', 'data-rule': String(x.id) }, el('span', { class: 'grow' }, el('strong', {}, x.name), x.active ? '' : ' (off)', el('div', { class: 'm' }, 'When ' + EVN[x.event] + ' · ' + x.conditions.length + ' condition(s) · ' + x.actions.map(function (a) { return a.type.replace('_', ' '); }).join(', '))),
              el('button', { type: 'button', class: 'btn l sm', 'data-rule-edit': String(x.id), onclick: function () { rd = JSON.parse(JSON.stringify(x)); draw(); } }, 'Edit'),
              el('button', { type: 'button', class: 'btn l sm', 'data-rule-delete': String(x.id), onclick: function () { api('rule-delete', { id: x.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); rules = null; say('Rule deleted.'); }); } }, 'Delete')); }),
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-rule-new': '1', onclick: function () { rd = { name: '', event: 'created', conditions: [], actions: [], once: true, active: true }; draw(); } }, 'New automation')));
        }
      } else if (manage === 'team') {
        if (!isAdmin) body = guardAdmin;
        else if (team === null) { api('team-list').then(function (r) { team = r.ok ? r.body : { people: [], invites: [], seats: {} }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var ie = el('input', { 'aria-label': 'Invite email', type: 'email', placeholder: 'teammate@company.com', maxlength: '254' }), ir = sel('Invite role', 'member', [['member', 'Agent'], ['admin', 'Admin']], function () {});
          var sm = team.seats || {}, seatText = sm.allowed ? sm.used + ' of ' + sm.allowed + ' seats used' : sm.used + ' seats used (no limit)';
          var reload = function (msg) { team = null; say(msg); };
          var cnt = function (f) { return team.people.filter(f).length; };
          var agentPanel = function (p) {
            var d = agentInfo[p.userId];
            if (!d) { api('agent-detail', { userId: p.userId }).then(function (r) { agentInfo[p.userId] = r.ok ? r.body : { error: r.body.error }; draw(); }); return el('div', { class: 'apanel' }, el('p', { class: 'm' }, 'Loading…')); }
            if (d.error) return el('div', { class: 'apanel' }, el('p', { class: 'm' }, d.error));
            var tile = function (v, l) { return el('div', { class: 'stat' }, el('div', { class: 'sv' }, String(v)), el('div', { class: 'sl' }, l)); };
            return el('div', { class: 'apanel', 'data-agent-panel': p.email },
              el('div', { class: 'stats' }, tile(d.counts.open, 'open'), tile(d.counts.pending, 'pending'), tile(d.counts.solved30, 'solved in 30 days'), tile(d.week.replies, 'replies this week'), tile(d.week.notes, 'notes this week')),
              el('h4', {}, 'What they can do'), el('p', { class: 'm' }, d.can.text), d.can.perms && d.can.perms.length ? el('div', {}, d.can.perms.map(function (x) { return el('span', { class: 'chip' }, x); })) : null,
              el('h4', {}, 'Their open tickets'), d.tickets.length ? d.tickets.map(function (t) { return el('button', { type: 'button', class: 'arow', onclick: function () { open(t.number); } }, el('strong', {}, '#' + t.number), ' ' + t.subject, el('span', { class: 'badge s-' + t.status }, cap(t.status))); }) : el('p', { class: 'm' }, 'None right now.'),
              el('h4', {}, 'Recent activity'), d.activity.length ? d.activity.map(function (a) { return el('div', { class: 'arow plain' }, el('span', { class: 'm' }, (a.kind === 'note' ? 'Noted on ' : 'Replied on ') + '#' + a.number + ' · ' + ago(a.at)), el('div', {}, a.snippet)); }) : el('p', { class: 'm' }, 'Nothing yet.'),
              d.changes && d.changes.length ? [el('h4', {}, 'Recent changes to settings'), d.changes.map(function (c) { return el('div', { class: 'arow plain' }, el('strong', {}, c.action), c.target ? ' · ' + c.target : '', el('span', { class: 'm' }, ' · ' + ago(c.at))); })] : null);
          };
          body = el('div', { class: 'mlist' }, el('div', { class: 'stats top', 'data-team-stats': '1' }, [[team.people.length, 'people'], [cnt(function (x) { return x.role === 'owner' || x.role === 'admin'; }), 'owners and admins'], [cnt(function (x) { return x.role === 'member'; }), 'full agents'], [cnt(function (x) { return x.role === 'light'; }), 'light agents'], [team.invites.length, 'invitations waiting']].map(function (x) { return el('div', { class: 'stat' }, el('div', { class: 'sv' }, String(x[0])), el('div', { class: 'sl' }, x[1])); })), el('p', { class: 'm', 'data-seats': '1' }, seatText + ' · ' + (sm.plan ? cap(sm.plan) + ' plan' : '') + (sm.allowed && sm.used >= sm.allowed ? ' · ' : ''), sm.allowed && sm.used >= sm.allowed ? el('a', { href: '/app.html' }, 'Add seats') : null),
            team.people.map(function (p) {
              var mine = p.userId === meId, rs = sel('Role of ' + (p.name || p.email), p.role, team.roles.map(function (x) { return [x, x === 'member' ? 'Agent' : x === 'light' ? 'Light agent (notes only)' : cap(x)]; }), function (v) { api('team-role', { memberId: p.memberId, role: v }).then(function (r) { if (!r.ok) { team = null; return say(r.body.error, true); } reload((p.name || p.email) + ' is now ' + (v === 'member' ? 'an agent' : 'an ' + v) + '.'); }); });
              if (mine) rs.disabled = true;
              var others = team.people.filter(function (x) { return x.userId !== p.userId; });
              var rmBtn = mine ? null : el('button', { type: 'button', class: 'btn l sm', 'data-remove': String(p.memberId), onclick: function () { var to = others.length ? others[0].memberId : ''; var pick = sel('Hand ' + (p.name || p.email) + "'s open tickets to", to, [['', 'Leave them unassigned']].concat(others.map(function (x) { return [x.memberId, x.name || x.email]; })), function (v) { to = v; }); var box = el('div', { class: 'pcard', 'data-remove-box': String(p.memberId) }, el('strong', {}, 'Remove ' + (p.name || p.email) + '?'), el('p', { class: 'm' }, 'They lose access right away. Their ' + p.openTickets + ' open ticket(s) go to:'), pick, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-remove-confirm': '1', onclick: function () { api('team-remove', { memberId: p.memberId, reassignTo: to }).then(function (r) { if (!r.ok) { team = null; return say(r.body.error, true); } reload(p.email + ' was removed.'); }); } }, 'Remove'), el('button', { type: 'button', class: 'btn l', onclick: function () { draw(); } }, 'Cancel'))); var row = main.querySelector('[data-person="' + p.memberId + '"]'); if (row) row.appendChild(box); } }, 'Remove');
              var more = el('button', { type: 'button', class: 'btn l sm', 'data-agent-detail': p.email, 'aria-expanded': String(agentOpen === p.userId), onclick: function () { if (agentOpen === p.userId) { agentOpen = ''; return draw(); } agentOpen = p.userId; delete agentInfo[p.userId]; draw(); } }, agentOpen === p.userId ? 'Hide details' : 'Details');
              var row = el('div', { class: 'mitem', 'data-person': String(p.memberId), style: 'flex-wrap:wrap' }, avatarEl('', p.name || p.email, null), el('span', { class: 'grow' }, el('strong', {}, (p.name || p.email) + (mine ? ' (you)' : '')), el('div', { class: 'm' }, p.email + ' · ' + p.openTickets + ' open · ' + (p.solved30 || 0) + ' solved in 30 days · last active ' + (p.lastActive ? ago(p.lastActive) : 'never')), p.customRole ? el('span', { class: 'chip' }, p.customRole) : null, p.available === false ? el('span', { class: 'chip off' }, 'Away') : null), rs, more, rmBtn);
              return el('div', { class: 'agent' }, row, agentOpen === p.userId ? agentPanel(p) : null);
            }),
            team.invites.length ? el('h3', {}, 'Waiting for an answer') : null,
            team.invites.map(function (i) { return el('div', { class: 'mitem', 'data-invite': i.id }, el('span', { class: 'grow' }, i.email, el('div', { class: 'm' }, (i.role === 'admin' ? 'Admin' : 'Agent') + ' · expires ' + when(i.expires_at))), el('button', { type: 'button', class: 'btn l sm', 'data-invite-resend': i.id, onclick: function () { api('team-invite-resend', { id: i.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); reload('Invitation sent again to ' + i.email + '.'); }); } }, 'Resend'), el('button', { type: 'button', class: 'btn l sm', 'data-invite-cancel': i.id, onclick: function () { api('team-invite-cancel', { id: i.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); reload('Invitation cancelled.'); }); } }, 'Cancel')); }),
            el('h3', {}, 'Invite someone'), el('div', { class: 'bar' }, ie, ir, el('button', { type: 'button', class: 'btn', 'data-invite-send': '1', onclick: function () { api('team-invite', { email: ie.value, role: ir.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); reload('Invitation sent to ' + r.body.email + '.'); }); } }, 'Send invitation')));
        }
      } else if (manage === 'fields') {
        if (!has('custom_fields')) body = lock('custom_fields');
        else if (!isAdmin) body = guardAdmin;
        else {
          var fn = el('input', { 'aria-label': 'Field name', placeholder: 'Field name, for example Order number', maxlength: '60', value: mEdit && mEdit.label || '' }), ft = sel('Field type', mEdit && mEdit.type || 'text', [['text', 'Text'], ['number', 'Number'], ['dropdown', 'Dropdown'], ['checkbox', 'Yes / no'], ['date', 'Date']], function (v) { mEdit = { id: mEdit && mEdit.id, label: fn.value, type: v, options: mEdit && mEdit.options }; draw(); });
          var fo = el('textarea', { 'aria-label': 'Dropdown choices', placeholder: 'One choice per line', maxlength: '2000' }); fo.value = mEdit && mEdit.options ? mEdit.options.join('\n') : '';
          var ftype = mEdit && mEdit.type || 'text';
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Extra fields agents fill in on each ticket, such as an order number, a product or a due date. The type of a field cannot change once it is made.'),
            fields.map(function (f) { return el('div', { class: 'mitem', 'data-field-row': f.key }, el('span', { class: 'grow' }, el('strong', {}, f.label), el('div', { class: 'm' }, f.type + (f.options && f.options.length ? ': ' + f.options.join(', ') : ''))), el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = { id: f.id, label: f.label, type: f.type, options: f.options }; draw(); } }, 'Edit'), el('button', { type: 'button', class: 'btn l sm', 'data-field-delete': f.key, onclick: function () { api('field-delete', { id: f.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); afterSave('Field deleted.'); }); } }, 'Delete')); }),
            el('div', { class: 'page', style: 'padding:12px 0' }, fn, mEdit && mEdit.id ? null : ft, ftype === 'dropdown' ? fo : null, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-field-save': '1', onclick: function () { api('field-save', { id: mEdit && mEdit.id, label: fn.value, type: ftype, options: fo.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); afterSave('Field saved.'); }); } }, mEdit && mEdit.id ? 'Save field' : 'Add field'), mEdit ? el('button', { type: 'button', class: 'btn l', onclick: function () { mEdit = null; draw(); } }, 'Cancel') : null)));
        }
      } else if (manage === 'support') {
        if (!isAdmin) body = guardAdmin;
        else if (supportAcc === null) { api('support-access-get').then(function (r) { supportAcc = r.ok ? r.body : { active: false, entries: [] }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var what = { 'support.entered': 'Looked in', 'support.access-granted': 'Access switched on', 'support.access-revoked': 'Access switched off' };
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'The EffDesk support team can open this workspace to help you. They see the desk the way an admin does, read-only: they cannot change anything, reply to customers or see your password. Every visit is recorded in your audit log and listed here.'),
            el('h3', {}, 'Recent visits'), (supportAcc.entries || []).length ? (supportAcc.entries || []).map(function (e) { return el('div', { class: 'mitem', 'data-support-entry': e.action }, el('span', { class: 'grow' }, (what[e.action] || e.action) + ' · ' + (e.who || '')), el('span', { class: 'm' }, ago(e.at))); }) : el('p', { class: 'm', 'data-support-none': '1' }, 'No visits yet.'));
        }
      } else if (manage === 'api') {
        if (!has('api')) body = lock('api');
        else if (!isAdmin) body = guardAdmin;
        else if (tokens === null) { api('tokens-list').then(function (r) { tokens = r.ok ? r.body.tokens : []; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var tn = el('input', { 'aria-label': 'Token name', placeholder: 'Token name, for example Zapier', maxlength: '60' });
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'API tokens let your own systems read and create tickets. Send the token as Authorization: Bearer <token>. The address is ' + root.location.origin + '/api/v1/tickets (see docs/API.md in the repository).'),
            newToken ? el('div', { class: 'pcard', 'data-token': '1' }, el('strong', {}, 'Your new token (shown once, copy it now)'), el('code', {}, newToken), el('button', { type: 'button', class: 'btn l sm', onclick: function () { newToken = ''; draw(); } }, 'I have copied it')) : null,
            tokens.map(function (t) { return el('div', { class: 'mitem', 'data-token-row': String(t.id) }, el('span', { class: 'grow' }, el('strong', {}, t.name), el('div', { class: 'm' }, 'Starts with ' + t.prefix + '… · last used: ' + (t.last_used_at ? ago(t.last_used_at) : 'never'))), el('button', { type: 'button', class: 'btn l sm', 'data-token-delete': String(t.id), onclick: function () { api('token-delete', { id: t.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); tokens = null; say('Token revoked. Anything using it stops working now.'); }); } }, 'Revoke')); }),
            el('div', { class: 'bar' }, tn, el('button', { type: 'button', class: 'btn', 'data-token-create': '1', onclick: function () { api('token-create', { name: tn.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); newToken = r.body.token; tokens = null; say('Token created.'); }); } }, 'Create token')));
        }
      } else if (manage === 'integrations') {
        if (!has('integrations')) body = lock('integrations');
        else if (!isAdmin) body = guardAdmin;
        else if (hooks === null) { api('webhooks-list').then(function (r) { hooks = r.ok ? r.body : { webhooks: [], events: [] }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var hk = sel('Webhook type', 'json', [['json', 'Signed JSON (your own system, Zapier, Make)'], ['slack', 'Slack channel'], ['teams', 'Microsoft Teams channel']], function () {});
          var hu = el('input', { 'aria-label': 'Webhook address', placeholder: 'https://hooks.example.com/effdesk', maxlength: '300', type: 'url' }), picks = {};
          var evs = el('div', { class: 'bar', role: 'group', 'aria-label': 'Events' }, hooks.events.map(function (e) { var cb = el('input', { type: 'checkbox', 'aria-label': e, 'data-event': e }); cb.checked = e !== 'ticket.mentioned'; picks[e] = cb; return el('label', { class: 'm' }, cb, ' ' + e); }));
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'A webhook tells another tool when something happens. Pick Slack or Microsoft Teams to post a short message in a channel (paste the incoming webhook address of the channel), or Signed JSON to connect Zapier, Make, a CRM or your own system. Signed JSON messages carry X-EffDesk-Signature: sha256= plus an HMAC of the timestamp, a dot and the body, made with the secret shown once when you add it.'),
            newSecret ? el('div', { class: 'pcard', 'data-secret': '1' }, el('strong', {}, 'Signing secret (shown once, copy it now)'), el('code', {}, newSecret), el('button', { type: 'button', class: 'btn l sm', onclick: function () { newSecret = ''; draw(); } }, 'I have copied it')) : null,
            hooks.webhooks.map(function (h) { return el('div', { class: 'mitem', 'data-hook': String(h.id) }, el('span', { class: 'grow' }, h.url, el('div', { class: 'm' }, ({ json: 'Signed JSON', slack: 'Slack', teams: 'Teams' })[h.kind || 'json'] + ' · ' + h.events.join(', ') + ' · last delivery: ' + (h.last_status || 'none yet') + (h.last_at ? ' (' + ago(h.last_at) + ')' : ''))), el('button', { type: 'button', class: 'btn l sm', 'data-hook-delete': String(h.id), onclick: function () { api('webhook-delete', { id: h.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); hooks = null; say('Webhook removed.'); }); } }, 'Delete')); }),
            el('div', { class: 'page', style: 'padding:12px 0' }, hk, hu, evs, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-hook-save': '1', onclick: function () { api('webhook-save', { kind: hk.value, url: hu.value, events: Object.keys(picks).filter(function (e) { return picks[e].checked; }) }).then(function (r) { if (!r.ok) return say(r.body.error, true); newSecret = r.body.secret || ''; hooks = null; say('Webhook added.'); }); } }, 'Add webhook'))));
        }
      } else if (manage === 'roles') {
        if (!has('custom_roles')) body = lock('custom_roles');
        else if (!isAdmin) body = guardAdmin;
        else if (rolesCfg === null) { api('roles-list').then(function (r) { rolesCfg = r.ok ? r.body : { roles: [], people: [], perms: [] }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var re = roleEdit || { name: '', permissions: [] }, rn = el('input', { 'aria-label': 'Role name', placeholder: 'Role name, for example Tier 1', maxlength: '40', value: re.name }), rp = {};
          var rbox = el('div', { class: 'perms', role: 'group', 'aria-label': 'What this role may do' }, rolesCfg.perms.map(function (pm) { var cb = el('input', { type: 'checkbox', 'aria-label': pm.label, 'data-perm': pm.id }); cb.checked = re.permissions.indexOf(pm.id) >= 0; rp[pm.id] = cb; return el('label', { class: 'chk' }, cb, ' ' + pm.label); }));
          var reload = function () { rolesCfg = null; loadInit().then(draw); };
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'A custom role limits what a full agent may change. Everyone can still read tickets, add internal notes and follow tickets. Owners and admins are never limited.'),
            rolesCfg.roles.map(function (ro) { return el('div', { class: 'mitem', 'data-role-item': String(ro.id) }, el('span', { class: 'grow' }, el('strong', {}, ro.name), el('div', { class: 'm' }, ro.people + (ro.people === 1 ? ' person · ' : ' people · ') + (ro.permissions.length ? ro.permissions.length + ' permissions' : 'read-only'))), el('button', { type: 'button', class: 'btn l sm', onclick: function () { roleEdit = ro; draw(); } }, 'Edit'), ' ', el('button', { type: 'button', class: 'btn l sm', 'data-role-delete': String(ro.id), onclick: function () { api('role-delete', { id: ro.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); roleEdit = null; say('Role deleted.'); reload(); }); } }, 'Delete')); }),
            el('h3', {}, roleEdit && roleEdit.id ? 'Edit role' : 'New role'), rn, rbox,
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-role-save': '1', onclick: function () { api('role-save', { id: roleEdit && roleEdit.id, name: rn.value, permissions: Object.keys(rp).filter(function (k) { return rp[k].checked; }) }).then(function (r) { if (!r.ok) return say(r.body.error, true); roleEdit = null; say('Role saved.'); reload(); }); } }, 'Save role'), roleEdit ? el('button', { type: 'button', class: 'btn l', onclick: function () { roleEdit = null; draw(); } }, 'Cancel') : null),
            el('h3', {}, 'Who has which role'),
            rolesCfg.people.filter(function (pp) { return pp.role === 'member'; }).map(function (pp) { return el('div', { class: 'mitem', 'data-role-person': pp.email }, el('span', { class: 'grow' }, pp.name || pp.email, el('div', { class: 'm' }, pp.email)), sel('Custom role for ' + pp.email, pp.customRoleId ? String(pp.customRoleId) : '', [['', 'No custom role (full agent)']].concat(rolesCfg.roles.map(function (ro) { return [String(ro.id), ro.name]; })), function (v) { api('role-assign', { userId: pp.userId, roleId: v || null }).then(function (r) { if (!r.ok) return say(r.body.error, true); say('Saved.'); reload(); }); })); }),
            rolesCfg.people.some(function (pp) { return pp.role === 'member'; }) ? null : el('p', { class: 'm' }, 'No full agents yet. Invite agents under Team first.'));
        }
      } else if (manage === 'audit') {
        if (!has('audit_log')) body = lock('audit_log');
        else if (!isAdmin) body = guardAdmin;
        else if (auditCfg === null) { api('audit-list', { filter: auditFilter, actor: auditWho }).then(function (r) { auditCfg = r.ok ? r.body : { entries: [], next: null }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var af = el('input', { 'aria-label': 'Filter by action', placeholder: 'Action, for example role- or sso-', value: auditFilter, maxlength: '60' }), aw = el('input', { 'aria-label': 'Filter by person', placeholder: 'Person, name or email', value: auditWho, maxlength: '100' });
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Every change to settings, roles, people and data, newest first.'),
            el('div', { class: 'bar' }, af, aw, el('button', { type: 'button', class: 'btn l', 'data-audit-filter': '1', onclick: function () { auditFilter = af.value; auditWho = aw.value; auditCfg = null; draw(); } }, 'Filter'), el('button', { type: 'button', class: 'btn l', 'data-audit-csv': '1', onclick: function () { api('audit-csv', { filter: auditFilter, actor: auditWho }).then(function (x) { if (!x.ok) return say(x.body.error, true); saveFile(x.body.filename, x.body.csv, 'text/csv'); }); } }, 'Download CSV')),
            auditCfg.entries.length ? auditCfg.entries.map(function (e) { return el('div', { class: 'mitem', 'data-audit-row': e.action }, el('span', { class: 'grow' }, el('strong', {}, e.action), e.target ? ' · ' + e.target : '', el('div', { class: 'm' }, (e.actorName || e.actor) + ' · ' + when(e.at)))); }) : el('p', { class: 'm' }, 'Nothing matches.'),
            auditCfg.next ? el('button', { type: 'button', class: 'btn l', 'data-audit-more': '1', onclick: function () { api('audit-list', { filter: auditFilter, actor: auditWho, before: auditCfg.next }).then(function (r) { if (!r.ok) return say(r.body.error, true); auditCfg = { entries: auditCfg.entries.concat(r.body.entries), next: r.body.next }; draw(); }); } }, 'Show older') : null);
        }
      } else if (manage === 'export') {
        if (!has('data_export')) body = lock('data_export');
        else if (!isAdmin) body = guardAdmin;
        else if (exportCfg === null) { api('export-info').then(function (r) { exportCfg = r.ok ? r.body : { tickets: 0, parts: 1 }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var parts = []; for (var pi = 1; pi <= exportCfg.parts; pi++) parts.push(pi);
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Your data is yours. ' + exportCfg.tickets + ' tickets. The JSON files hold tickets with every message, plus clients, queues, macros and help articles (in part 1). Each file holds up to ' + (exportCfg.partSize || 300) + ' tickets. Every download is recorded in the audit log.'),
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-export-csv': '1', onclick: function () { api('export-tickets-csv').then(function (x) { if (!x.ok) return say(x.body.error, true); saveFile(x.body.filename, x.body.csv, 'text/csv'); }); } }, 'Ticket list (CSV)')),
            el('h3', {}, 'Everything (JSON)'), el('div', { class: 'bar' }, parts.map(function (n) { return el('button', { type: 'button', class: 'btn l', 'data-export-part': String(n), onclick: function () { api('export-data', { part: n }).then(function (x) { if (!x.ok) return say(x.body.error, true); saveFile(x.body.filename, x.body.json, 'application/json'); }); } }, 'Part ' + n); })));
        }
      } else if (manage === 'routing') {
        if (!has('routing')) body = lock('routing');
        else if (!isAdmin) body = guardAdmin;
        else if (routingCfg === null) { api('routing-get').then(function (r) { routingCfg = r.ok ? r.body.settings : { enabled: false, strategy: 'round_robin', max_open: null }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var ron = el('input', { type: 'checkbox', 'aria-label': 'Assign new tickets automatically' }); ron.checked = !!routingCfg.enabled;
          var rst = sel('How to choose', routingCfg.strategy, [['round_robin', 'Round robin: take turns, whoever waited longest'], ['least_busy', 'Least busy: the agent with the fewest open tickets']], function () {});
          var rmax = el('input', { 'aria-label': 'Open tickets limit', type: 'number', min: '1', max: '500', placeholder: 'No limit', value: routingCfg.max_open || '' });
          var rteam = team ? team.people.filter(function (x) { return x.role !== 'light'; }) : null;
          if (!team) api('team-list').then(function (r) { if (r.ok) { team = r.body; draw(); } });
          body = el('div', { class: 'page', style: 'padding:12px 0' }, el('p', { class: 'm' }, 'When a customer starts a ticket (help center, email, chat or API), it is given to a full agent right away. Light agents and agents who are away are skipped. Tickets you create yourself are not routed.'),
            el('label', { class: 'chk' }, ron, ' Assign new tickets automatically'), prop('How to choose', rst), prop('Most open tickets one agent may hold', rmax),
            el('p', { class: 'm' }, 'If everyone is away or at the limit, the ticket waits unassigned.'),
            guardAdmin || el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-routing-save': '1', onclick: function () { api('routing-save', { enabled: ron.checked, strategy: rst.value, maxOpen: rmax.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); routingCfg = r.body.settings; say('Routing saved.'); draw(); }); } }, 'Save')),
            el('h3', {}, 'Who is available now'), rteam ? rteam.map(function (x) { return el('div', { class: 'mitem', 'data-avail': x.email }, avatarEl('', x.name || x.email, null), el('span', { class: 'grow' }, x.name || x.email, el('div', { class: 'm' }, x.openTickets + ' open')), el('span', { class: 'chip' + (x.available === false ? ' off' : '') }, x.available === false ? 'Away' : 'Available')); }) : el('p', { class: 'm' }, 'Loading…'),
            el('p', { class: 'm' }, 'Agents switch themselves away or back from their profile menu (top right).'));
        }
      } else if (manage === 'helpwidget') {
        var slug1 = (orgs.filter(function (o) { return o.id === orgId; })[0] || {}).slug || '', site = (root.location && root.location.origin) || '';
        var wsnip = '<script src="' + site + '/help-widget.js" data-org="' + slug1 + '" async></script>';
        body = el('div', { class: 'page', style: 'padding:12px 0' }, el('p', { class: 'm' }, 'Your customers can search your articles and send requests without signing in. These are the addresses to share or link from your website.'),
          prop('Help center', el('a', { href: site + '/help/' + slug1, target: '_blank', rel: 'noopener', 'data-help-link': '1' }, site + '/help/' + slug1)),
          prop('Send a request page', el('a', { href: site + '/help/' + slug1 + '/requests/new', target: '_blank', rel: 'noopener', 'data-request-link': '1' }, site + '/help/' + slug1 + '/requests/new')),
          prop('Search box for your website: add this line just before </body>', el('pre', { class: 'snip', 'data-help-snippet': '1' }, wsnip)),
          el('p', { class: 'm' }, 'Options on that line: data-lang="es" for Spanish, data-color="#1f73b7" for the button color, data-position="left" to put it on the left, data-label="Support" for the button text, and data-target="#my-box" to draw the search box inside your own page instead of a button.'));
      } else if (manage === 'forms') {
        if (!has('request_forms')) body = lock('request_forms');
        else if (!isAdmin) body = guardAdmin;
        else if (formsCfg === null) { api('forms-list').then(function (r) { formsCfg = r.ok ? r.body : { forms: [] }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var fe = formEdit || { name: '', description: '', subject_hint: '', queue_id: null, type: 'question', priority: 'normal', tags: [], field_keys: [], active: true, approval_config: { enabled: false, mode: 'all', approverIds: [], tasks: [] } };
          var fn = el('input', { 'aria-label': 'Form name', placeholder: 'Form name, for example Billing question', maxlength: '60', value: fe.name }), fd = el('input', { 'aria-label': 'Form description', placeholder: 'Shown above the form', maxlength: '300', value: fe.description }), fh = el('input', { 'aria-label': 'Subject hint', placeholder: 'Hint in the subject box', maxlength: '100', value: fe.subject_hint });
          var fq = sel('Queue for these requests', fe.queue_id ? String(fe.queue_id) : '', [['', 'No queue']].concat(queues.map(function (q) { return [String(q.id), q.name]; })), function () {}), ft = sel('Ticket type', fe.type, [['question', 'Question'], ['incident', 'Incident'], ['problem', 'Problem'], ['task', 'Task']], function () {}), fp = sel('Priority', fe.priority, [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], function () {});
          var fl = el('input', { 'aria-label': 'Labels', placeholder: 'Labels added to every request, separated by commas', maxlength: '200', value: (fe.tags || []).join(', ') }), fk = {};
          var fbox = !has('custom_fields') ? el('p', { class: 'm' }, 'Extra fields come with the Suite plan (Ticket fields).') : fields.length ? el('div', { class: 'perms', role: 'group', 'aria-label': 'Extra fields to ask' }, fields.map(function (f) { var cb = el('input', { type: 'checkbox', 'aria-label': f.label, 'data-form-field': f.key }); cb.checked = (fe.field_keys || []).indexOf(f.key) >= 0; fk[f.key] = cb; return el('label', { class: 'chk' }, cb, ' ' + f.label); })) : el('p', { class: 'm' }, 'Add ticket fields under Manage → Ticket fields to ask for more than the basics.');
          var fa = el('input', { type: 'checkbox', 'aria-label': 'Offer this form to customers' }); fa.checked = fe.active !== false;
           var ac = fe.approval_config || { enabled: false, mode: 'all', approverIds: [], stages: [], tasks: [] }, ae = el('input', { type: 'checkbox', 'aria-label': 'Require approval before fulfillment' }); ae.checked = ac.enabled === true;
           var stageDrafts = (ac.stages && ac.stages.length ? ac.stages : (ac.approverIds || []).length ? [{ name: 'Approval', mode: ac.mode === 'any' ? 'any' : 'all', approverIds: ac.approverIds }] : []).map(function (s, i) { return { name: s.name || 'Stage ' + (i + 1), mode: s.mode === 'any' ? 'any' : 'all', approverIds: (s.approverIds || []).slice() }; });
           var stageEditor = el('div', { class: 'form-task-editor' });
           var drawStageEditor = function () {
             while (stageEditor.firstChild) stageEditor.removeChild(stageEditor.firstChild);
             if (!stageDrafts.length) stageEditor.appendChild(el('p', { class: 'm' }, 'Add at least one approval stage and choose its approvers.'));
             stageDrafts.forEach(function (stage, index) {
               var name = el('input', { maxlength: '80', 'aria-label': 'Approval stage ' + (index + 1) + ' name', placeholder: 'Stage name', value: stage.name });
               name.addEventListener('input', function () { stage.name = name.value; });
               var mode = sel('Decision rule', stage.mode, [['all', 'All selected approvers'], ['any', 'Any one approver']], function (v) { stage.mode = v; });
               var checks = el('div', { class: 'perms', role: 'group', 'aria-label': 'Approvers for ' + stage.name });
               agents.forEach(function (agent) { var cb = el('input', { type: 'checkbox', 'aria-label': agent.name || agent.email }); cb.checked = stage.approverIds.indexOf(agent.id) >= 0; cb.addEventListener('change', function () { if (cb.checked && stage.approverIds.indexOf(agent.id) < 0) stage.approverIds.push(agent.id); else if (!cb.checked) stage.approverIds = stage.approverIds.filter(function (id) { return id !== agent.id; }); }); checks.appendChild(el('label', { class: 'chk' }, cb, ' ' + (agent.name || agent.email))); });
               stageEditor.appendChild(el('div', { class: 'form-task-row' }, el('div', { class: 'form-task-fields' }, el('strong', {}, 'Stage ' + (index + 1)), name, mode, checks), index ? el('button', { type: 'button', class: 'btn l sm', onclick: function () { stageDrafts.splice(index, 1); drawStageEditor(); } }, 'Remove') : null));
             });
             stageEditor.appendChild(el('button', { type: 'button', class: 'btn l sm', onclick: function () { if (stageDrafts.length >= 10) return say('A workflow can have up to 10 approval stages.', true); stageDrafts.push({ name: 'Stage ' + (stageDrafts.length + 1), mode: 'all', approverIds: [] }); drawStageEditor(); } }, '+ Add sequential stage'));
           };
           drawStageEditor();
           var reminderHours = el('input', { type: 'number', min: '1', max: '720', step: '1', 'aria-label': 'Hours between approval reminders', value: String(ac.reminderHours || 24) });
           var maxReminders = el('input', { type: 'number', min: '0', max: '20', step: '1', 'aria-label': 'Maximum approval reminders', value: String(ac.maxReminders === undefined ? 3 : ac.maxReminders) });
           var taskDrafts = (ac.tasks || []).map(function (t) { return { title: t.title || '', description: t.description || '', assigneeId: t.assigneeId || '' }; });
           var taskEditor = el('div', { class: 'form-task-editor' });
           var drawTaskEditor = function () {
             while (taskEditor.firstChild) taskEditor.removeChild(taskEditor.firstChild);
             if (!taskDrafts.length) taskEditor.appendChild(el('p', { class: 'm' }, 'No fulfillment tasks yet. Add tasks that should be completed after approval.'));
             taskDrafts.forEach(function (task, index) {
               var title = el('input', { 'aria-label': 'Fulfillment task ' + (index + 1) + ' title', maxlength: '160', placeholder: 'Task title', value: task.title });
               var description = el('textarea', { 'aria-label': 'Fulfillment task ' + (index + 1) + ' instructions', rows: '2', maxlength: '3000', placeholder: 'Instructions (optional)' }); description.value = task.description;
               var assignee = sel('Task assignee', task.assigneeId, [['', 'Unassigned']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { task.assigneeId = v; });
               title.addEventListener('input', function () { task.title = title.value; });
               description.addEventListener('input', function () { task.description = description.value; });
               taskEditor.appendChild(el('div', { class: 'form-task-row', 'data-form-task': String(index) }, el('div', { class: 'form-task-fields' }, title, description, assignee), el('button', { type: 'button', class: 'btn l sm', 'aria-label': 'Remove fulfillment task ' + (index + 1), onclick: function () { taskDrafts.splice(index, 1); drawTaskEditor(); } }, 'Remove')));
             });
             taskEditor.appendChild(el('button', { type: 'button', class: 'btn l sm', onclick: function () { if (taskDrafts.length >= 20) return say('A request form can have up to 20 fulfillment tasks.', true); taskDrafts.push({ title: '', description: '', assigneeId: '' }); drawTaskEditor(); } }, '+ Add fulfillment task'));
           };
           drawTaskEditor();
          var freload = function () { formsCfg = null; draw(); };
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Customers always have the plain "Submit a request" page. Forms let them pick what their request is about, and each form sets the queue, type, priority and labels for you.'),
            formsCfg.forms.map(function (f) { return el('div', { class: 'mitem', 'data-form-item': String(f.id) }, el('span', { class: 'grow' }, el('strong', {}, f.name), f.active ? '' : el('span', { class: 'chip' }, 'Off'), el('div', { class: 'm' }, f.tickets + (f.tickets === 1 ? ' request' : ' requests') + (f.description ? ' · ' + f.description : ''))), el('button', { type: 'button', class: 'btn l sm', onclick: function () { formEdit = f; draw(); } }, 'Edit'), ' ', el('button', { type: 'button', class: 'btn l sm', 'data-form-delete': String(f.id), onclick: function () { api('form-delete', { id: f.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); formEdit = null; say('Form deleted.'); freload(); }); } }, 'Delete')); }),
            formsCfg.forms.length ? null : el('p', { class: 'm' }, 'No forms yet.'),
            el('h3', {}, formEdit && formEdit.id ? 'Edit form' : 'New form'), prop('Name', fn), prop('Description', fd), prop('Subject hint', fh), prop('Queue', fq), prop('Type', ft), prop('Priority', fp), prop('Labels', fl), el('h4', {}, 'Extra fields to ask'), fbox,
            el('label', { class: 'chk' }, fa, ' Offer this form to customers'),
            el('h4', {}, 'Approval workflow'), el('label', { class: 'chk' }, ae, ' Require approval before fulfillment'), el('p', { class: 'm' }, 'Stages run in order. Each stage can require every selected approver or any one approver. The next stage is notified only after the current stage is complete.'), stageEditor,
            prop('Remind approvers every (hours)', reminderHours), prop('Maximum reminders per stage (0 disables reminders)', maxReminders), el('p', { class: 'm' }, 'Reminders are checked hourly. The first reminder is sent after the selected interval; the count resets when the next approval stage begins. Email notification preferences are respected.'),
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-form-save': '1', onclick: function () { api('form-save', { id: formEdit && formEdit.id, name: fn.value, description: fd.value, subjectHint: fh.value, queueId: fq.value, type: ft.value, priority: fp.value, tags: fl.value, fieldKeys: Object.keys(fk).filter(function (k) { return fk[k].checked; }), active: fa.checked, approvalConfig: { enabled: ae.checked, mode: stageDrafts.length > 1 ? 'sequential' : (stageDrafts[0] ? stageDrafts[0].mode : 'all'), stages: stageDrafts.map(function (stage) { return { name: stage.name, mode: stage.mode, approverIds: stage.approverIds }; }), reminderHours: Number(reminderHours.value), maxReminders: Number(maxReminders.value), tasks: taskDrafts.filter(function (task) { return task.title.trim(); }).map(function (task) { return { title: task.title, description: task.description, assigneeId: task.assigneeId }; }) } }).then(function (r) { if (!r.ok) return say(r.body.error, true); formEdit = null; say('Form saved.'); freload(); }); } }, 'Save form'), formEdit ? el('button', { type: 'button', class: 'btn l', onclick: function () { formEdit = null; draw(); } }, 'Cancel') : null));
        }
      } else if (manage === 'chat') {
        if (!has('live_chat')) body = lock('live_chat');
        else if (!chatCfg) { api('chat-get').then(function (r) { chatCfg = r.ok ? r.body.settings : { enabled: false, title: 'Chat with us', greeting: '', color: '#1f73b7' }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var cc = chatCfg, on = el('input', { type: 'checkbox', 'aria-label': 'Show the chat button on your website' }); on.checked = !!cc.enabled;
          var ct = el('input', { 'aria-label': 'Chat title', value: cc.title, maxlength: '60' }), cg = el('textarea', { 'aria-label': 'Chat greeting', maxlength: '300' }), ck = el('input', { 'aria-label': 'Chat color', type: 'color', value: cc.color }); cg.value = cc.greeting;
          var snippet = '<script src="' + (root.location && root.location.origin || '') + '/widget.js" data-org="' + (orgs.filter(function (o) { return o.id === orgId; })[0] || {}).slug + '" async></script>';
          body = el('div', { class: 'page', style: 'padding:12px 0' }, el('p', { class: 'm' }, 'Visitors chat from a button on your website. Each chat is a ticket in this desk. While their chat window is open your replies appear there; after they leave, replies are emailed.'),
            el('label', { class: 'chk' }, on, ' Show the chat button on your website'), prop('Title', ct), prop('Greeting', cg), prop('Button color', ck),
            guardAdmin || el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-chat-save': '1', onclick: function () { api('chat-save', { enabled: on.checked, title: ct.value, greeting: cg.value, color: ck.value }).then(function (r) { if (!r.ok) return noteFrom(r); chatCfg = r.body.settings; say('Chat settings saved.'); draw(); }); } }, 'Save')),
            prop('Add this line to your website, just before </body>', el('pre', { class: 'snip', 'data-chat-snippet': '1' }, snippet)));
        }
      } else if (manage === 'whatsapp') {
        if (!has('whatsapp')) body = lock('whatsapp');
        else if (!waCfg) { api('whatsapp-templates').then(function (x) { waTpls = x.ok ? x.body.templates : []; }); api('whatsapp-get').then(function (r) { waCfg = r.ok ? r.body.settings : { enabled: false, phoneNumberId: '', displayPhone: '', verifyToken: '', hasToken: false, webhookUrl: '' }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var wc = waCfg, won = el('input', { type: 'checkbox', 'aria-label': 'Receive and send WhatsApp messages' }); won.checked = !!wc.enabled;
          var wpid = el('input', { 'aria-label': 'Phone number ID', value: wc.phoneNumberId, maxlength: '30', inputmode: 'numeric' }), wdp = el('input', { 'aria-label': 'Number shown to customers', value: wc.displayPhone, maxlength: '40', placeholder: '+1 555 0100' });
          var wtok = el('input', { 'aria-label': 'Access token', type: 'password', autocomplete: 'off', placeholder: wc.hasToken ? 'Saved. Leave empty to keep it.' : 'Paste the permanent access token' }), wsec = el('input', { 'aria-label': 'App secret', type: 'password', autocomplete: 'off', placeholder: wc.hasToken ? 'Saved. Leave empty to keep it.' : 'Paste the app secret' });
          body = el('div', { class: 'page', style: 'padding:12px 0' }, el('p', { class: 'm' }, 'Customers message your WhatsApp Business number and each conversation is a ticket here. Agents reply from the desk. WhatsApp only allows free-text replies within 24 hours of the customer\'s last message; after that the desk tells you and keeps your text. After that you can send an approved template (below) to start the conversation again. Every message you send shows whether it was sent, delivered or read. Photos, voice messages and documents the customer sends are saved on the ticket.'),
            el('ol', { class: 'steps' }, el('li', {}, 'In Meta for Developers, open your app\'s WhatsApp setup and copy the phone number ID, a permanent access token and the app secret (Settings, Basic).'), el('li', {}, 'Save them here. Then paste the webhook address and verify token below into WhatsApp, Configuration, Webhook, and subscribe to "messages".')),
            el('label', { class: 'chk' }, won, ' Receive and send WhatsApp messages'), prop('Phone number ID', wpid), prop('Number shown to customers', wdp), prop('Access token', wtok), prop('App secret', wsec),
            guardAdmin || el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-wa-save': '1', onclick: function () { api('whatsapp-save', { enabled: won.checked, phoneNumberId: wpid.value, displayPhone: wdp.value, accessToken: wtok.value, appSecret: wsec.value }).then(function (r) { if (!r.ok) return noteFrom(r); waCfg = r.body.settings; say('WhatsApp settings saved.'); draw(); }); } }, 'Save')),
            el('h3', {}, 'Message templates'), el('p', { class: 'm' }, 'Templates are texts WhatsApp has approved for your number. They are the only thing you can send after 24 hours of silence. Create and approve them in Meta first, then list each one here exactly as approved, with {{1}}, {{2}} where the variables go.'),
            (waTpls || []).length ? el('ul', { class: 'tpls' }, (waTpls || []).map(function (x) { return el('li', { 'data-wa-template': x.name }, el('strong', {}, x.name + ' (' + x.language + ')'), ' ', el('span', { class: 'm' }, x.body), ' ', guardAdmin || el('button', { type: 'button', class: 'edit', 'data-wa-template-delete': x.name, onclick: function () { api('whatsapp-template-delete', { name: x.name, language: x.language }).then(function (r) { if (!r.ok) return noteFrom(r); waTpls = r.body.templates; say('Template removed.'); draw(); }); } }, 'Remove')); })) : el('p', { class: 'm' }, 'No templates yet.'),
            guardAdmin || (function () { var tn = el('input', { 'aria-label': 'Template name', maxlength: '100', placeholder: 'order_update' }), tl2 = el('input', { 'aria-label': 'Template language', maxlength: '12', value: 'en_US' }), tb = el('textarea', { 'aria-label': 'Template text', maxlength: '1024', placeholder: 'Hi {{1}}, your visit is {{2}}.' });
              return el('div', {}, prop('Name in Meta', tn), prop('Language code', tl2), prop('Text as approved', tb), el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-wa-template-save': '1', onclick: function () { api('whatsapp-template-save', { name: tn.value, language: tl2.value, body: tb.value }).then(function (r) { if (!r.ok) return noteFrom(r); waTpls = r.body.templates; say('Template saved.'); draw(); }); } }, 'Add template'))); })(),
            wc.verifyToken ? prop('Webhook address', el('pre', { class: 'snip', 'data-wa-url': '1' }, wc.webhookUrl)) : null, wc.verifyToken ? prop('Verify token', el('pre', { class: 'snip', 'data-wa-verify': '1' }, wc.verifyToken)) : null);
        }
      } else if (manage === 'sso') {
        if (!has('sso')) body = lock('sso');
        else if (guardAdmin) body = guardAdmin;
        else if (!ssoCfg) { api('sso-get').then(function (r) { ssoCfg = r.ok ? r.body : { sso: { configured: false, enabled: false, issuer: '', clientId: '', domains: [], defaultRole: 'member', enforce: false }, callback: '' }; draw(); }); body = el('p', { class: 'm' }, 'Loading…'); }
        else {
          var so = ssoCfg.sso, sOn = el('input', { type: 'checkbox', 'aria-label': 'Turn on single sign-on' }), sEnf = el('input', { type: 'checkbox', 'aria-label': 'Require single sign-on for these domains' }); sOn.checked = !!so.enabled; sEnf.checked = !!so.enforce;
          var sIss = el('input', { 'aria-label': 'Issuer', value: so.issuer, placeholder: 'https://your-company.okta.com', maxlength: '300' }), sCid = el('input', { 'aria-label': 'Client ID', value: so.clientId, maxlength: '300' }), sSec = el('input', { 'aria-label': 'Client secret', type: 'password', placeholder: so.hasSecret ? 'Saved. Leave empty to keep it.' : '', maxlength: '500', autocomplete: 'off' });
          var sDom = el('input', { 'aria-label': 'Company email domains', value: (so.domains || []).join(', '), placeholder: 'acme.com, acme.co.uk', maxlength: '300' }), sRole = sel('Role for new people', so.defaultRole, [['member', 'Agent'], ['admin', 'Admin']], function () { });
          body = el('div', { class: 'page', style: 'padding:12px 0' }, el('p', { class: 'm' }, 'Let people sign in with your company identity provider (Okta, Microsoft Entra, Google Workspace, Auth0, Keycloak or any OpenID Connect provider). People with a company email address are added to this workspace the first time they sign in. Someone who already has an EffDesk account must be invited first.'),
            prop('Redirect address to give your identity provider', el('pre', { class: 'snip', 'data-sso-callback': '1' }, ssoCfg.callback)),
            prop('Issuer', sIss), prop('Client ID', sCid), prop('Client secret', sSec), prop('Company email domains', sDom), prop('Role for new people', sRole),
            el('label', { class: 'chk' }, sOn, ' Turn on single sign-on'), el('label', { class: 'chk' }, sEnf, ' Require it for these domains (the password form refuses them)'),
            el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-sso-save': '1', onclick: function () { api('sso-save', { issuer: sIss.value, clientId: sCid.value, clientSecret: sSec.value, domains: sDom.value, defaultRole: sRole.value, enabled: sOn.checked, enforce: sEnf.checked }).then(function (r) { if (!r.ok) return noteFrom(r); ssoCfg.sso = r.body.sso; say('Single sign-on saved.'); draw(); }); } }, 'Save'),
              so.configured ? el('button', { type: 'button', class: 'btn l', 'data-sso-delete': '1', onclick: function () { api('sso-delete').then(function (r) { if (!r.ok) return noteFrom(r); ssoCfg = null; say('Single sign-on removed.'); draw(); }); } }, 'Remove') : null));
        }
      } else if (manage === 'migrate') {
        if (guardAdmin) body = guardAdmin;
        else {
          var zd = mig.provider === 'zendesk', mp = sel('Move from', mig.provider, [['zendesk', 'Zendesk'], ['freshdesk', 'Freshdesk']], function (v) { mig.provider = v; mig.state = 'idle'; mig.note = ''; draw(); });
          var ma = el('input', { 'aria-label': 'Account address', value: mig.sub, placeholder: 'acme (from acme.' + (zd ? 'zendesk' : 'freshdesk') + '.com)', maxlength: '80', autocomplete: 'off' }), me2 = el('input', { 'aria-label': 'Admin email', value: mig.email, placeholder: 'you@company.com', maxlength: '254', autocomplete: 'off', type: 'email' }), mt = el('input', { 'aria-label': zd ? 'API token' : 'API key', type: 'password', value: mig.token, maxlength: '200', autocomplete: 'off' });
          ma.addEventListener('input', function () { mig.sub = ma.value; }); me2.addEventListener('input', function () { mig.email = me2.value; }); mt.addEventListener('input', function () { mig.token = mt.value; });
          var creds = function () { return zd ? { provider: 'zendesk', creds: { subdomain: ma.value, email: me2.value, token: mt.value } } : { provider: 'freshdesk', creds: { domain: ma.value, token: mt.value } }; };
          var step = function (cursor) {
            if (mig.state !== 'running') return;
            api('migrate-run', Object.assign(creds(), { cursor: cursor })).then(function (r) {
              if (r.status === 429) { mig.note = r.body.error; draw(); return root.setTimeout(function () { step(cursor); }, (r.body.retryAfter || 30) * 1000); }
              if (!r.ok) { mig.state = 'failed'; mig.note = r.body.error || 'The move stopped.'; return draw(); }
              mig.tickets += r.body.tickets.added; mig.skipped += r.body.tickets.existing + r.body.tickets.skipped + r.body.articles.skipped; mig.messages += r.body.messages; mig.articles += r.body.articles.added; mig.note = '';
              if (!r.body.next) { mig.state = 'done'; return draw(); }
              draw(); step(r.body.next);
            }).catch(function () { mig.state = 'failed'; mig.note = 'The connection dropped. Start again; what was moved is kept and nothing is copied twice.'; draw(); });
          };
          var start = function () { mig.tickets = mig.messages = mig.articles = mig.skipped = 0; mig.note = ''; api('migrate-check', creds()).then(function (r) { if (!r.ok) return say(r.body.error, true); mig.state = 'running'; draw(); step(null); }); };
          var help = zd ? ['In Zendesk, open Admin Center, then Apps and integrations, then APIs, then Zendesk API.', 'Turn on Token access and add an API token. Copy it now; Zendesk shows it once.', 'Use the email of an admin and the part of your address before .zendesk.com.'] : ['In Freshdesk, click your profile picture, then Profile settings.', 'Copy your API key from the right-hand side.', 'Use the part of your address before .freshdesk.com. The key must belong to an admin.'];
          body = el('div', { class: 'page', style: 'padding:0' },
            el('ol', { class: 'mhelp' }, help.map(function (h) { return el('li', {}, h); })),
            prop('Move from', mp), prop('Account address', ma), zd ? prop('Admin email', me2) : null, prop(zd ? 'API token' : 'API key', mt),
            el('p', { class: 'm' }, 'Tickets keep their numbers, messages, internal notes, labels, status and dates. Files are listed but not copied. Running it again never makes copies. Your token is used only while this page is moving data and is not saved.'),
            mig.state === 'running' ? el('div', { class: 'pcard', 'data-migrate-progress': '1', role: 'status' }, el('strong', {}, 'Moving… keep this page open'), el('div', { class: 'm' }, mig.tickets + ' tickets, ' + mig.messages + ' messages, ' + mig.articles + ' articles so far'), mig.note ? el('div', { class: 'm' }, mig.note) : null) : null,
            mig.state === 'done' ? el('div', { class: 'pcard', 'data-migrate-done': '1', role: 'status' }, el('strong', {}, 'Done'), el('div', { class: 'm' }, mig.tickets + ' tickets, ' + mig.messages + ' messages and ' + mig.articles + ' articles moved' + (mig.skipped ? ', ' + mig.skipped + ' already there or skipped' : '') + '.')) : null,
            mig.state === 'failed' ? el('div', { class: 'pcard', 'data-migrate-failed': '1', role: 'alert' }, el('strong', {}, 'The move stopped'), el('div', { class: 'm' }, mig.note), el('div', { class: 'm' }, 'So far: ' + mig.tickets + ' tickets, ' + mig.articles + ' articles.')) : null,
            el('div', { class: 'bar' }, el('button', Object.assign({ type: 'button', class: 'btn', 'data-migrate-start': '1', onclick: start }, mig.state === 'running' ? { disabled: 'disabled' } : {}), mig.state === 'running' ? 'Moving…' : mig.state === 'idle' ? 'Check and start' : 'Start again')));
        }
      } else if (manage === 'sla') {
        if (!has('sla')) body = lock('sla');
        else { var P = ['low', 'normal', 'high', 'urgent'], inputs = {}, hrs = function (v) { return v ? String(Math.round(v / 6) / 10) : ''; };
          P.forEach(function (p) { var cur = (sla || {})[p] || {}; inputs[p] = { f: el('input', { 'aria-label': cap(p) + ' first reply in hours', inputmode: 'decimal', placeholder: 'none', value: hrs(cur.firstResponseMin) }), r: el('input', { 'aria-label': cap(p) + ' solve in hours', inputmode: 'decimal', placeholder: 'none', value: hrs(cur.resolveMin) }) }; });
          var toMin = function (v) { var n = parseFloat(String(v).replace(',', '.')); return String(v).trim() === '' ? null : Math.round(n * 60); };
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Set how many hours the team has, counted around the clock from when a ticket is created, unless you set business hours below. A ticket is at risk when 80% of the time is used, and breached when it runs out. Leave a box empty for no target.'),
            el('table', { class: 'slatable' }, el('thead', {}, el('tr', {}, el('th', {}, 'Priority'), el('th', {}, 'First reply within (hours)'), el('th', {}, 'Solved within (hours)'))), el('tbody', {}, P.map(function (p) { return el('tr', {}, el('td', {}, cap(p)), el('td', {}, inputs[p].f), el('td', {}, inputs[p].r)); }))),
            guardAdmin || el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-sla-save': '1', onclick: function () { var pol = {}; P.forEach(function (p) { pol[p] = { firstResponseMin: toMin(inputs[p].f.value), resolveMin: toMin(inputs[p].r.value) }; }); api('sla-save', { policies: pol }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('SLA targets saved.'); }); } }, 'Save targets'))); body.appendChild(hoursPane()); }
      } else {
        var m = mEdit || {}, mn = el('input', { 'aria-label': 'Macro name', placeholder: 'Macro name, for example Thanks and solve', maxlength: '80', value: m.name || '' }), mb = el('textarea', { 'aria-label': 'Macro text', placeholder: 'The reply. Use {{name}} for the requester\'s first name and {{agent}} for you.' }); mb.value = m.body || '';
        var ms = sel('Macro status', m.status || '', [['', 'Do not change the status'], ['open', 'Set to open'], ['pending', 'Set to pending'], ['on_hold', 'Set to on hold'], ['solved', 'Set to solved'], ['closed', 'Set to closed']], function () {}), mp = sel('Macro priority', m.priority || '', [['', 'Do not change the priority'], ['low', 'Set to low'], ['normal', 'Set to normal'], ['high', 'Set to high'], ['urgent', 'Set to urgent']], function () {}), mt = el('input', { 'aria-label': 'Macro labels', placeholder: 'Labels to add, comma separated', value: (m.add_tags || []).join(', ') });
        body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'A macro is a canned reply. Pick it in the reply box; it can also set the status, priority and labels when you send.'), macros.map(function (y) { return el('div', { class: 'mitem', 'data-macro-item': String(y.id) }, el('span', { class: 't' }, y.name), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = y; draw(); } }, 'Edit'), el('button', { type: 'button', class: 'btn l sm', 'data-macro-delete': String(y.id), onclick: function () { api('macro-delete', { id: y.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Macro deleted.'); }); } }, 'Delete')) : null); }),
          guardAdmin || el('div', { class: 'page', style: 'padding:12px 0' }, mn, mb, ms, mp, mt, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-macro-save': '1', onclick: function () { api('macro-save', { id: m.id, name: mn.value, body: mb.value, status: ms.value, priority: mp.value, addTags: mt.value }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Macro saved.'); }); } }, m.id ? 'Save macro' : 'Add macro'), m.id ? el('button', { type: 'button', class: 'btn l', onclick: function () { mEdit = null; draw(); } }, 'Cancel') : null)));
      }
      return el('div', { class: 'page mgr' }, el('h2', {}, 'Manage'), el('div', { class: 'mgrid' + (mDetail ? ' m-detail' : '') }, head, el('section', { class: 'mmain', 'aria-label': cur[1] }, el('button', { type: 'button', class: 'mback', 'data-mback': '1', onclick: function () { mDetail = false; draw(); } }, '\u2039 All settings'), el('h3', { class: 'mtitle' }, cur[1]), el('p', { class: 'm mdesc' }, cur[2]), body)));
    }

    // ── profile and themes ──
    // a picture is cut to a centred 128 x 128 square on the device before it is sent
    function shrink(file) {
      if (nav.shrink) return nav.shrink(file);
      return new Promise(function (ok, no) { var url = (root.URL || URL).createObjectURL(file), img = new root.Image(); img.onload = function () { var c = doc.createElement('canvas'); c.width = c.height = 128; var side = Math.min(img.width, img.height); c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 128, 128); (root.URL || URL).revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85)); }; img.onerror = no; img.src = url; });
    }
    function saveAvatar(data) { return api('prefs-save', { avatar: data }).then(function (r) { if (!r.ok) return say(r.body.error, true); myAvatar = r.body.avatar || null; paintMe(); loadInit().then(function () { say(myAvatar ? 'Profile picture saved.' : 'Profile picture removed.'); }); }); }
    function profilePane() {
      var avFile = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': 'Upload a profile picture', 'data-avatar-file': '1' });
      avFile.addEventListener('change', function () { var f = avFile.files && avFile.files[0]; if (!f) return; if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return say('Choose a PNG, JPEG or WebP picture.', true); shrink(f).then(saveAvatar, function () { say('That picture could not be read.', true); }); });
      var nb = el('input', { type: 'checkbox', 'aria-label': 'Email me about my tickets', 'data-notify': '1' }); nb.checked = notify; nb.addEventListener('change', function () { var want = nb.checked; api('prefs-save', { notify: want }).then(function (r) { if (!r.ok) { nb.checked = notify; return say(r.body.error, true); } notify = want; say(want ? 'Notification emails on.' : 'Notification emails off.'); }); });
      var cards = THEMES.map(function (t) {
        var locked = !!t.pro && !has('themes');
        var b = el('button', { type: 'button', class: 'theme', 'data-theme-id': t.id, 'aria-pressed': String(theme === t.id), 'aria-disabled': String(locked), 'aria-label': t.name + ' theme' + (locked ? ' (paid plans)' : '') },
          el('span', { class: 'sw' }, el('i', { style: 'background:' + t.sw[0] }), el('b', { style: 'background:' + t.sw[1] }, el('em', { style: 'background:' + t.sw[2] + ';width:80%;border:1px solid rgba(127,127,127,.3)' }), el('em', { style: 'background:' + t.sw[2] + ';width:60%;border:1px solid rgba(127,127,127,.3)' }), el('em', { style: 'background:' + t.sw[3] + ';width:34%' }))),
          el('span', { class: 'nm' }, t.name), el('span', { class: 'm', style: 'display:block' }, t.blurb), t.pro ? el('span', { class: 'pro' }, 'PRO') : null);
        b.addEventListener('click', function () { if (locked) return say('The ' + t.name + ' theme comes with the ' + PLAN_OF.themes + ' plan and above. Upgrade on the account page to use it.', true); var prev = theme; applyTheme(t.id); api('prefs-save', { theme: t.id }).then(function (r) { if (!r.ok) { applyTheme(prev); return say(r.body.error, true); } note = t.name + ' theme on.'; bad = false; draw(); }); });
        return b;
      });
      return el('div', { class: 'page' }, el('h2', {}, 'Profile and themes'), el('div', { class: 'pcard', style: 'width:100%;max-width:520px' }, el('div', { class: 'row1' }, avatarEl('', meName, myAvatar), el('div', {}, el('strong', {}, meName), el('div', { class: 'm' }, me)))), el('h3', {}, 'Profile picture'), el('div', { class: 'bar' }, avFile, myAvatar ? el('button', { type: 'button', class: 'btn l sm', 'data-avatar-remove': '1', onclick: function () { saveAvatar(null); } }, 'Remove') : null), el('p', { class: 'm' }, 'PNG, JPEG or WebP. It is shrunk on your device and shown to your teammates.'), el('h3', {}, 'Email notifications'), el('label', { class: 'bar' }, nb, ' Email me when a customer replies on a ticket I own or follow, and when a ticket is assigned to me'), el('h3', {}, 'Theme'), el('p', { class: 'm' }, 'Pick how your desk looks. It follows you on every device. Classic and Midnight are on every plan' + (has('themes') ? '; the PRO themes are yours too.' : '; the PRO themes come with paid plans.')), el('div', { class: 'themes' }, cards), !has('themes') ? lock('themes') : null);
    }
    function mailPane() {
      var m = settings, f = {};
      f.inbox = el('input', { 'aria-label': 'Support address', value: m.inbox || m.suggestedInbox, maxlength: '32' });
      f.mode = sel('Replies', m.replyMode, [['ticket', 'Customer replies come back into the ticket'], ['custom', 'Customer replies go to my own address'], ['none', 'No-reply: customers cannot reply']], function (v) { m.replyMode = v; m.inbox = f.inbox.value; m.fromName = f.fromName.value; m.signature = f.sig.value; m.replyTo = f.replyTo.value; draw(); });
      f.replyTo = el('input', { 'aria-label': 'Reply-to address', type: 'email', placeholder: 'support@yourcompany.com', value: m.replyTo || '' });
      f.fromName = el('input', { 'aria-label': 'Sender name', placeholder: 'Sender name (for example Acme Support)', value: m.fromName || '', maxlength: '100' });
      f.sig = el('textarea', { 'aria-label': 'Signature', placeholder: 'Signature added to every reply', maxlength: '1000' }); f.sig.value = m.signature || '';
      var ro = role === 'owner' || role === 'admin';
      var csatBox = el('input', { type: 'checkbox', 'aria-label': 'Ask customers to rate their support', 'data-csat-on': '1' }); csatBox.checked = m.csatOn !== false; csatBox.addEventListener('change', function () { var on = csatBox.checked; api('csat-set', { on: on }).then(function (r) { if (!r.ok) { csatBox.checked = !on; return say(r.body.error, true); } m.csatOn = on; say(on ? 'Customers will be asked to rate solved tickets.' : 'Rating requests are off.'); }); });
      return el('div', { class: 'page' }, el('h2', {}, 'Email settings'),
        el('p', { class: 'm' }, 'Customers write to ' + (m.inbox || m.suggestedInbox) + '@' + m.domain + '. Forward your existing support mailbox there to bring that mail in too.'),
        el('div', { class: 'bar' }, f.inbox, el('span', { class: 'm' }, '@' + m.domain)), el('div', { class: 'bar' }, f.mode), m.replyMode === 'custom' ? el('div', { class: 'bar' }, f.replyTo) : null,
        el('div', { class: 'bar' }, f.fromName), f.sig,
        ro ? el('label', { class: 'bar m' }, csatBox, ' Ask customers to rate their support when a ticket is solved') : null,
        ro ? el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-mail-save': '1', onclick: function () { api('mail-save', { inbox: f.inbox.value, replyMode: m.replyMode, replyTo: f.replyTo.value, fromName: f.fromName.value, signature: f.sig.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); settings = r.body; say('Email settings saved.'); }); } }, 'Save'), el('button', { class: 'btn l', type: 'button', onclick: function () { settings = null; draw(); } }, 'Close')) : el('p', { class: 'm' }, 'Only an owner or an admin can change these.'));
    }
    function articlesPane() {
      if (editing) {
        var e = editing, isNew = !e.id, f = {};
        f.title = el('input', { 'aria-label': 'Title', placeholder: 'Title', maxlength: '200', value: e.title || '' });
        f.lang = sel('Language', e.lang || 'en', [['en', 'English'], ['es', 'Español']], function (v) { e.lang = v; });
        if (!isNew) f.lang.setAttribute('disabled', 'disabled');
        var others = articles.filter(function (a) { return a.id !== e.id; });
        f.tr = isNew ? sel('Translation of', e.translationOf || '', [['', 'A new article (not a translation)']].concat(others.map(function (a) { return [a.id, 'Translation of: ' + a.title + ' (' + a.lang + ')']; })), function (v) { e.translationOf = v; }) : null;
        f.cat = el('input', { 'aria-label': 'Category', placeholder: 'Category, for example Getting started', maxlength: '60', value: e.category || '', list: 'article-cats' });
        f.cats = el('datalist', { id: 'article-cats' }, [...new Set((articles || []).map(function (a) { return a.category; }).filter(Boolean))].map(function (c) { return el('option', { value: c }); }));
        var upBytes = function (kind, file) { return fetchFn('/api/help-assets/' + kind + '?org=' + encodeURIComponent(orgId), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || 'That file could not be uploaded.'); return j; }); }); };
        f.ed = root.EffArticleEditor ? root.EffArticleEditor.create(doc, { html: e.editHtml || '', canSource: has('article_import'), canImport: has('article_import'), say: say, upload: function (file) { return upBytes('image', file).then(function (j) { return j.url; }); }, importPdf: function (file) { return upBytes('pdf', file); }, onTitle: function (t) { if (!f.title.value.trim()) f.title.value = t; } }) : null;
        f.body = f.ed ? f.ed.el : el('textarea', { 'aria-label': 'Article text', rows: '12' });
        f.pub = el('input', { type: 'checkbox', 'aria-label': 'Published' }); if (e.status === 'published') f.pub.checked = true;
        return el('div', { class: 'page' }, el('h2', {}, isNew ? 'New article' : 'Edit article'), f.title, el('div', { class: 'bar' }, f.lang, f.tr, f.cat, f.cats), f.body,
          el('label', { class: 'bar' }, f.pub, ' Published (visible to customers)'),
          el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-article-save': '1', onclick: function () { api('article-save', { id: e.id, title: f.title.value, body: f.ed ? f.ed.getHtml() : f.body.value, format: f.ed ? 'html' : 'text', category: f.cat.value, lang: e.lang || 'en', translationOf: e.translationOf || undefined, status: f.pub.checked ? 'published' : 'draft' }).then(function (r) { if (!r.ok) return say(r.body.error, true); editing = null; note = 'Article saved.'; bad = false; return loadArticles(); }); } }, 'Save'),
            !isNew ? el('button', { class: 'btn l', type: 'button', 'data-article-delete': '1', onclick: function () { api('article-delete', { id: e.id }).then(function () { editing = null; return loadArticles(); }); } }, 'Delete') : null,
            el('button', { class: 'btn l', type: 'button', onclick: function () { editing = null; draw(); } }, 'Cancel')));
      }
      return el('div', { class: 'page' }, el('h2', {}, 'Help center'), el('p', { class: 'm' }, 'Public address: /help/' + slug), el('div', { class: 'bar' }, el('a', { class: 'btn l', href: '/help/' + encodeURIComponent(slug), target: '_blank', rel: 'noopener', 'data-view-help': '1' }, 'View the help center'), el('button', { class: 'btn', type: 'button', 'data-article-new': '1', onclick: function () { editing = { lang: 'en' }; draw(); } }, 'New article'), el('button', { class: 'btn l', type: 'button', onclick: function () { articles = null; draw(); } }, 'Close')),
        articles.length ? articles.map(function (a) { return el('button', { class: 'row art', type: 'button', 'data-article': a.id, onclick: function () { api('article-get', { id: a.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); editing = r.body.article; draw(); }); } }, el('b', {}, a.title), el('span', { class: 'm' }, (a.status === 'published' ? 'Published' : 'Draft') + ' · ' + (a.lang === 'es' ? 'Español' : 'English') + ' · ' + a.views + ' views · ' + a.helpful_yes + ' helpful, ' + a.helpful_no + ' not')); }) : el('p', { class: 'm' }, 'No articles yet.'));
    }
    function loadArticles() { return api('article-list').then(function (r) { if (!r.ok) return say(r.body.error, true); closePanes(); articles = r.body.articles; draw(); }); }
    function draw() {
      drawChrome(); drawMenu();
      if (root.EffI18n) { root.EffI18n.setLocale(locale, { persist: false }); }
      qBox.placeholder = tr('Search tickets, contacts, companies, agents…'); qBox.setAttribute('aria-label', tr('Search tickets')); newBtn.textContent = tr('+ New ticket');
      while (main.firstChild) main.removeChild(main.firstChild);
      if (note) main.appendChild(el('p', { class: 'msg toast' + (bad ? ' err' : ''), role: bad ? 'alert' : 'status' }, note, el('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', onclick: function () { note = ''; draw(); } }, '×')));
      main.appendChild(el('div', { class: 'desk' }, ciOpen ? configurationItemsPane() : changesOpen ? changesPane() : problemsOpen ? problemsPane() : incidentsOpen ? itsmPane() : approvalInbox ? approvalsPane() : home ? homePane() : profile ? profilePane() : report ? reportPane() : articles ? articlesPane() : settings ? mailPane() : manage ? managePane() : creating ? newPane() : current ? ticketPane() : viewsPane()));
    }
    return boot();
  }
  root.EffDeskDesk = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); }, path: root.location.pathname, host: root.location.hostname, replace: function (u) { root.history.replaceState(null, '', u); } });
})(typeof window !== 'undefined' ? window : this);
