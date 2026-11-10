// public/js/desk.js: the agent desk, laid out like a help-desk console: an icon rail, ticket tabs, a Views tab with filters, queues and saved views, a ticket in three columns (properties, conversation, requester/client/linked/side conversations/timeline), Manage (queues, clients, macros), Email settings, Help center, and the profile menu with themes. Draws text only.
(function (root) {
  'use strict';
  var STATUS = ['active', 'open', 'pending', 'solved', 'closed'];
  var ICONS = { home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', tickets: 'M4 6h16M4 12h16M4 18h16', mail: 'M3 6h18v12H3z M3 7l9 6 9-6', help: 'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z M12 6v13', manage: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6', reports: 'M4 20V11M10 20V4M16 20v-8M22 20H2', account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6' };
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
  var PLAN_OF = { sso: 'Pro', live_chat: 'Suite', custom_fields: 'Suite', light_agents: 'Team', bulk_actions: 'Team', queues: 'Team', clients: 'Team', linked_tickets: 'Team', saved_views: 'Team', themes: 'Team', side_conversations: 'Suite', translation: 'Suite', sla: 'Team', reports: 'Team', integrations: 'Team', triggers: 'Team', api: 'Suite' };
  function start(doc, fetchFn, nav) {
    var main = doc.getElementById('main'), rail = doc.getElementById('rail'), tabsEl = doc.getElementById('tabs'), qBox = doc.getElementById('q'), newBtn = doc.getElementById('newbtn'), orgSlot = doc.getElementById('orgsel'), userBtn = doc.getElementById('userbtn'), userMenu = doc.getElementById('usermenu');
    var orgId = '', orgs = [], agents = [], list = [], counts = {}, filter = { status: 'active', assignee: '', q: '' }, current = null, note = '', bad = false, creating = false, settings = null, role = '', slug = '', pending = [], articles = null, editing = null, openTabs = [], draft = '', mode = 'reply', me = '', meId = '', meName = '';
    var myNo = '', chatCfg = null, ssoCfg = null, support = false, supportEntered = false, supportAcc = null, fields = [], hoursCfg = null, picked = {}, team = null, tokens = null, newToken = '', rules = null, rd = null, myAvatar = null, hooks = null, newSecret = '', home = true, dash = null, features = [], queues = [], clients = [], macros = [], views = [], labels = [], isAdmin = false, theme = 'classic', manage = '', profile = false, report = null, reportDays = 30, translated = {}, notify = true, sla = null, editMsg = null, mergeArmed = false, macroPatch = null, sendStatus = '', savingView = false, menuOpen = false, mEdit = null;
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else if (k === 'value') e.value = props[k]; else e.setAttribute(k, props[k]); }); [].concat.apply([], [].slice.call(arguments, 2)).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
    var icon = function (name) { var ns = 'http://www.w3.org/2000/svg', s = doc.createElementNS(ns, 'svg'), p = doc.createElementNS(ns, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', ICONS[name]); s.appendChild(p); return s; };
    var post = function (path, body) { return fetchFn(path, { method: path === '/api/me' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: path === '/api/me' ? undefined : JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var api = function (action, extra) { return post('/api/tickets', Object.assign({ orgId: orgId, action: action }, extra || {})); };
    var say = function (t, isBad) { note = t; bad = !!isBad; draw(); };
    var size = function (n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
    var when = function (s) { try { return new Date(s).toLocaleString(); } catch (e) { return String(s); } };
    var ago = function (s) { var m = Math.round((Date.now() - new Date(s).getTime()) / 60000); if (!isFinite(m)) return ''; if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago'; return Math.round(m / 1440) + ' d ago'; };
    var cap = function (s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; };
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
    var closePanes = function () { picked = {}; home = false; current = null; creating = false; settings = null; articles = null; editing = null; manage = ''; profile = false; report = null; mergeArmed = false; editMsg = null; };
    var noteFrom = function (r) { return say(r.body.error || 'That did not work.', true); };

    function applyTheme(id) { theme = id; doc.documentElement.setAttribute('data-theme', id); try { root.localStorage.setItem('eff_theme', id); } catch (e) { /* storage may be blocked */ } }
    function boot() {
      return post('/api/me').then(function (r) {
        if (r.status === 401) return nav.go('/auth.html?mode=signin');
        orgs = r.body.organizations; me = r.body.user.email; meId = r.body.user.id; meName = r.body.user.name || me; doc.getElementById('who').textContent = me; doc.getElementById('av').textContent = initial(me);
        var pm = /^\/w\/([a-z0-9-]+)(?:\/agent\/\d+)?(?:\/tickets\/(\d+))?/.exec(nav.path || ''), want = new URLSearchParams(nav.search || '').get('org'); var o = (pm && orgs.filter(function (x) { return x.slug === pm[1]; })[0]) || orgs.filter(function (x) { return x.id === want; })[0] || (new URLSearchParams(nav.search || '').get('support') && want ? { id: want, role: 'admin', slug: '' } : orgs[0]);
        if (!o) { main.textContent = ''; main.appendChild(el('p', { class: 'pad' }, 'Create an organization first on the ', el('a', { href: '/app.html' }, 'account page'), '.')); return; }
        orgId = o.id; role = o.role; slug = o.slug; var tn = Number(new URLSearchParams(nav.search || '').get('ticket')) || (pm && Number(pm[2])) || 0; myNo = r.body.user.agentNumber || ''; return loadInit().then(refresh).then(function () { if (tn > 0) return open(tn); return goHome(); });
      });
    }
    function supportBar() {
      if (!doc.getElementById('supportbar')) { var bar = el('div', { id: 'supportbar', class: 'supportbar', role: 'status', 'data-support-bar': '1' }, 'Support view: you are looking at this workspace with the customer’s permission. It is read-only and every visit is logged for them. ', el('a', { href: '/admin.html#customers' }, 'Back to the admin page')); doc.body.insertBefore(bar, doc.body.firstChild); }
      if (!supportEntered) { supportEntered = true; api('support-enter'); }
    }
    function loadInit() { return api('init').then(function (r) { if (!r.ok) return; var b = r.body; agents = b.agents || []; myAvatar = b.avatar || null; paintMe(); features = b.features || []; queues = b.queues || []; clients = b.clients || []; macros = b.macros || []; fields = b.fields || []; support = !!b.support; if (support) supportBar(); views = b.views || []; labels = b.labels || []; isAdmin = !!b.admin; notify = b.notify !== false; sla = b.sla || null; if (b.theme) applyTheme(b.theme); }); }
    function refresh() { return api('list', filter).then(function (r) { if (r.ok) { list = r.body.tickets; counts = r.body.counts; } else say(r.body.error || 'That did not work.', true); draw(); }); }
    // the address bar shows where you are, like /w/acme/agent/10042/tickets/57
    function addr(n) { try { if (nav.replace && slug && myNo) nav.replace('/w/' + slug + '/agent/' + myNo + '/tickets' + (n ? '/' + n : '')); } catch (e) { /* address only */ } }
    function open(n) {
      return api('get', { number: n }).then(function (r) {
        if (!r.ok) return say(r.body.error, true); addr(n);
        if (!current || current.ticket.number !== n) { draft = ''; mode = 'reply'; pending = []; macroPatch = null; sendStatus = ''; }
        closePanes(); current = r.body;
        var hit = openTabs.filter(function (x) { return x.number === n; })[0]; if (hit) hit.subject = r.body.ticket.subject; else openTabs.push({ number: n, subject: r.body.ticket.subject });
        draw();
      });
    }
    function goViews() { closePanes(); draw(); }
    function goHome() { addr(0); closePanes(); home = true; return api('dashboard').then(function (r) { dash = r.ok ? r.body : null; if (!r.ok) say(r.body.error || 'That did not work.', true); else draw(); }); }
    function search() { filter.q = qBox.value.trim(); closePanes(); refresh(); }
    qBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    newBtn.addEventListener('click', function () { closePanes(); creating = true; newf = blankNew(); pending = []; draw(); });

    // ── the profile menu ──
    function setMenu(on) { menuOpen = on; userBtn.setAttribute('aria-expanded', String(on)); drawMenu(); }
    function drawMenu() {
      while (userMenu.firstChild) userMenu.removeChild(userMenu.firstChild);
      userMenu.hidden = !menuOpen; if (!menuOpen) return;
      userMenu.appendChild(el('div', { class: 'who-line' }, el('strong', {}, meName), el('div', { class: 'm' }, me)));
      userMenu.appendChild(el('button', { type: 'button', role: 'menuitem', 'data-profile': '1', onclick: function () { setMenu(false); closePanes(); profile = true; draw(); } }, 'Profile and themes'));
      userMenu.appendChild(el('a', { role: 'menuitem', href: '/app.html', 'data-account': '1' }, 'Account and billing'));
      userMenu.appendChild(el('button', { type: 'button', role: 'menuitem', 'data-signout': '1', onclick: function () { post('/api/auth/sign-out', {}).then(function () { nav.go('/'); }); } }, 'Sign out'));
    }
    userBtn.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!menuOpen); });
    doc.addEventListener('click', function (e) { if (menuOpen && !userMenu.contains(e.target)) setMenu(false); });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menuOpen) { setMenu(false); userBtn.focus(); } });

    // ── chrome: the rail and the tabs ──
    function drawChrome() {
      var where = home ? 'home' : articles ? 'help' : settings ? 'mail' : manage ? 'manage' : report ? 'reports' : 'tickets';
      var item = function (name, label, data, onclick) { var b = el('button', { type: 'button', class: 'ri', 'aria-label': label, title: label, 'aria-current': String(where === name) }, icon(name)); b.setAttribute(data, '1'); b.addEventListener('click', onclick); return b; };
      while (rail.firstChild) rail.removeChild(rail.firstChild);
      rail.appendChild(el('a', { class: 'logo', href: '/desk.html' + (orgId ? '?org=' + encodeURIComponent(orgId) : ''), 'data-home': '1', 'aria-label': 'Dashboard', title: 'Dashboard', onclick: function (e) { e.preventDefault(); goHome(); } }, 'E'));
      rail.appendChild(item('home', 'Dashboard', 'data-dash', goHome));
      rail.appendChild(item('tickets', 'Tickets', 'data-nav', goViews));
      rail.appendChild(item('manage', 'Manage queues, clients and macros', 'data-manage', function () { closePanes(); manage = 'queues'; mEdit = null; draw(); }));
      rail.appendChild(item('reports', 'Reports', 'data-reports', loadReport));
      rail.appendChild(item('mail', 'Email settings', 'data-mail', function () { api('mail-get').then(function (r) { if (!r.ok) return say(r.body.error, true); closePanes(); settings = r.body; draw(); }); }));
      rail.appendChild(item('help', 'Help center', 'data-help', loadArticles));
      rail.appendChild(el('span', { class: 'grow' }));
      rail.appendChild(el('a', { class: 'ri', href: '/app.html', 'aria-label': 'Account', title: 'Account and billing' }, icon('account')));
      while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);
      var onViews = !home && !current && !creating && !settings && !articles && !manage && !profile && !report;
      tabsEl.appendChild(el('button', { type: 'button', role: 'tab', class: 'tab', 'data-home-tab': '1', 'aria-selected': String(home), onclick: goHome }, 'Home'));
      tabsEl.appendChild(el('button', { type: 'button', role: 'tab', class: 'tab', 'data-views': '1', 'aria-selected': String(onViews), onclick: goViews }, 'Views'));
      openTabs.forEach(function (t) {
        var on = !!current && current.ticket.number === t.number;
        tabsEl.appendChild(el('span', { class: 'tab has-x', 'aria-selected': String(on) },
          el('button', { type: 'button', role: 'tab', 'data-tab': String(t.number), 'aria-selected': String(on), onclick: function () { open(t.number); } }, '#' + t.number + ' ' + t.subject),
          el('button', { type: 'button', class: 'x', 'data-close': String(t.number), 'aria-label': 'Close #' + t.number, onclick: function () { openTabs = openTabs.filter(function (x) { return x.number !== t.number; }); if (current && current.ticket.number === t.number) current = null; draw(); } }, '×')));
      });
      while (orgSlot.firstChild) orgSlot.removeChild(orgSlot.firstChild);
      if (orgs.length > 1) orgSlot.appendChild(sel('Organization', orgId, orgs.map(function (o) { return [o.id, o.name]; }), function (v) { orgId = v; closePanes(); openTabs = []; loadInit().then(refresh); }));
    }

    // ── Views: filters, queues, saved views and the ticket table ──
    function applyFilter(f) { filter = Object.assign({ status: '', assignee: '', q: '' }, f); qBox.value = filter.q || ''; refresh(); }
    function viewsPane() {
      var n = function (s) { return s === 'active' ? (counts.open || 0) + (counts.pending || 0) : counts[s]; };
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
        views.forEach(function (v) { side.appendChild(el('div', { class: 'vrow' }, flt(v.name + (v.shared ? ' (team)' : ''), false, function () { applyFilter(v.filter); }, null, ['data-view', String(v.id)]), v.mine || isAdmin ? el('button', { type: 'button', class: 'x', 'aria-label': 'Delete the view ' + v.name, 'data-view-delete': String(v.id), onclick: function () { api('view-delete', { id: v.id }).then(function (r) { if (!r.ok) return noteFrom(r); return loadInit().then(draw); }); } }, '×') : null)); });
        if (savingView) {
          var nm = el('input', { 'aria-label': 'View name', placeholder: 'Name this view', maxlength: '60' }), sh = el('input', { type: 'checkbox', 'aria-label': 'Share with the team' });
          side.appendChild(el('div', { class: 'saveview' }, nm, el('button', { type: 'button', class: 'btn sm', 'data-view-save': '1', onclick: function () { api('view-save', { name: nm.value, shared: sh.checked, filter: filter }).then(function (r) { if (!r.ok) return noteFrom(r); savingView = false; return loadInit().then(draw); }); } }, 'Save')));
          if (isAdmin) side.appendChild(el('label', { class: 'm' }, sh, ' Share with the team'));
        } else side.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-view-new': '1', style: 'margin-top:8px', onclick: function () { savingView = true; draw(); } }, 'Save current filter as a view'));
      }
      var name = function (id) { var a = agents.filter(function (x) { return x.id === id; })[0]; return a ? (a.name || a.email) : ''; };
      var pickBox = function (n) { var cb = el('input', { type: 'checkbox', 'aria-label': 'Select #' + n, 'data-pick': String(n) }); cb.checked = !!picked[n]; cb.addEventListener('click', function (e) { e.stopPropagation(); }); cb.addEventListener('change', function () { if (cb.checked) picked[n] = true; else delete picked[n]; draw(); }); return cb; };
      var nPicked = Object.keys(picked).length, bulk = function (patch, label) { return api('bulk', { numbers: Object.keys(picked).map(Number), patch: patch }).then(function (r) { if (!r.ok) return say(r.body.error, true); picked = {}; return refresh().then(function () { say(label + ': ' + r.body.done + ' ticket(s) updated' + (r.body.failed ? ', ' + r.body.failed + ' could not be changed (' + r.body.error + ')' : '') + '.', !!r.body.failed); }); }); };
      var bulkBar = nPicked ? el('div', { class: 'bar bulk', role: 'group', 'aria-label': 'Bulk actions', 'data-bulk': '1' }, el('strong', {}, nPicked + ' selected'),
        sel('Set status for the selected tickets', '', [['', 'Set status…'], ['open', 'Open'], ['pending', 'Pending'], ['solved', 'Solved'], ['closed', 'Closed']], function (v) { if (v) bulk({ status: v }, 'Status'); }),
        sel('Set priority for the selected tickets', '', [['', 'Set priority…'], ['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], function (v) { if (v) bulk({ priority: v }, 'Priority'); }),
        sel('Assign the selected tickets', '', [['', 'Assign to…'], ['none', 'Nobody']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { if (v) bulk({ assigneeId: v === 'none' ? null : v }, 'Assignee'); }),
        el('button', { type: 'button', class: 'btn l sm', onclick: function () { picked = {}; draw(); } }, 'Clear')) : null;
      var rows = list.map(function (t) {
        var tags = (t.tags || []).map(function (g) { return el('button', { type: 'button', class: 'tag', 'data-tag': g, onclick: function (e) { e.stopPropagation(); filter = { status: '', assignee: '', q: '', tag: g }; refresh(); } }, g); });
        var tr = el('tr', { class: 'row', tabindex: '0', 'data-number': String(t.number), 'aria-current': String(!!current && current.ticket.number === t.number) },
          has('bulk_actions') ? el('td', { class: 'pick' }, pickBox(t.number)) : null, el('td', {}, el('span', { class: 'badge s-' + t.status }, cap(t.status))), el('td', { class: 'num' }, '#' + t.number), el('td', { class: 'subj' }, t.subject, tags.length ? el('span', { class: 'tagline' }, tags) : null), el('td', {}, t.requester_name || t.requester_email), el('td', {}, cap(t.priority)), el('td', {}, name(t.assignee_id) || '—'), has('sla') ? el('td', {}, t.sla && t.sla.worst !== 'ok' && t.sla.worst !== 'met' ? el('span', { class: 'sla s-' + t.sla.worst, 'data-sla-row': t.sla.worst }, t.sla.worst === 'breached' ? 'Breached' : t.sla.worst === 'missed' ? 'Missed' : 'At risk') : '') : null, el('td', { class: 'when' }, ago(t.updated_at)));
        tr.addEventListener('click', function () { open(t.number); }); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(t.number); });
        return tr;
      });
      return el('div', { class: 'views' }, side, el('div', { class: 'tbl' }, bulkBar, list.length ? el('table', {}, el('thead', {}, el('tr', {}, (has('bulk_actions') ? [''] : []).concat(['Status', 'Ticket', 'Subject', 'Requester', 'Priority', 'Assignee'].concat(has('sla') ? ['SLA'] : [], ['Updated'])).map(function (h, i) { if (has('bulk_actions') && i === 0) { var all = el('input', { type: 'checkbox', 'aria-label': 'Select all tickets on this page', 'data-pick-all': '1' }); all.checked = list.length > 0 && list.every(function (t) { return picked[t.number]; }); all.addEventListener('change', function () { list.forEach(function (t) { if (all.checked) picked[t.number] = true; else delete picked[t.number]; }); draw(); }); return el('th', {}, all); } return el('th', {}, h); }))), el('tbody', {}, rows)) : el('p', { class: 'm pad' }, 'No tickets here.')));
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
    function sel(label, value, opts, onchange) { var s = el('select', { 'aria-label': label }, opts.map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === value) op.setAttribute('selected', 'selected'); return op; })); s.value = value; s.addEventListener('change', function () { onchange(s.value); }); return s; }
    var prop = function (label, child) { return el('div', { class: 'prop' }, el('div', { class: 'pl' }, label), child); };

    // ── a ticket in three columns ──
    function ticketPane() {
      var t = current.ticket, x = current.extras || { followers: [], events: [], sides: [], incidents: [], merged: [] }, body = el('textarea', { 'aria-label': 'Message', placeholder: mode === 'note' ? 'Write an internal note. Only your team sees it.' : 'Write a public reply. The customer is emailed.' });
      body.value = draft; body.addEventListener('input', function () { draft = body.value; }); if (mode === 'reply') body.addEventListener('paste', pasteFiles(t)); var bodyBox = editor(body, t);
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
      var send = function (action) {
        draft = body.value; if (!body.value.trim()) return say('Write a message first.', true);
        var status = action === 'reply' ? (sendStatus || (macroPatch && macroPatch.status) || undefined) : undefined, ids = action === 'reply' ? pending.map(function (p) { return p.id; }) : [], mp = action === 'reply' ? macroPatch : null;
        api(action, { number: t.number, body: body.value, status: status, attachmentIds: ids }).then(function (r) {
          if (!r.ok) return say(r.body.error, true);
          var n = ''; if (r.body.email === 'failed') n = 'Saved, but the email could not be sent. Try again later.'; else if (r.body.email === 'skipped') n = r.body.emailWhy === 'no-inbox' ? 'Saved, but no email was sent: set up your support address under Email settings.' : r.body.emailWhy === 'limit' ? 'Saved, but no email was sent: you reached today\'s email limit for your plan.' : '';
          pending = []; draft = ''; macroPatch = null; sendStatus = '';
          var patch = {}; if (mp && mp.priority) patch.priority = mp.priority; if (mp && mp.add_tags && mp.add_tags.length) patch.tags = (t.tags || []).concat(mp.add_tags);
          return (Object.keys(patch).length ? api('update', { number: t.number, patch: patch }) : Promise.resolve()).then(after).then(function () { if (n) say(n, true); });
        });
      };
      body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(mode === 'note' ? 'note' : 'reply'); });
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
        prop('Status', sel('Status', t.status, [['open', 'Open'], ['pending', 'Pending'], ['solved', 'Solved'], ['closed', 'Closed']], function (v) { update({ status: v }); })),
        has('custom_fields') ? fields.map(function (f) { return prop(f.label, fieldInput(f, (t.custom || {})[f.key])); }) : null,
        prop('Type', sel('Type', t.type || 'question', [['question', 'Question'], ['incident', 'Incident'], ['problem', 'Problem'], ['task', 'Task']], function (v) { update({ type: v }); })),
        prop('Queue', has('queues') ? sel('Queue', t.queue_id ? String(t.queue_id) : '', [['', 'No queue']].concat(queues.map(function (q) { return [String(q.id), q.name]; })), function (v) { update({ queueId: v || null }); }) : lock('queues')),
        prop('Client', has('clients') ? sel('Client', t.client_id ? String(t.client_id) : '', [['', 'No client']].concat(clients.map(function (k) { return [String(k.id), k.name]; })), function (v) { update({ clientId: v || null }); }) : lock('clients')),
        prop('Labels', el('div', {}, el('div', { class: 'chips' }, (t.tags || []).map(function (g) { return el('span', { class: 'chip', 'data-label': g }, g, el('button', { type: 'button', 'aria-label': 'Remove the label ' + g, onclick: function () { update({ tags: (t.tags || []).filter(function (y) { return y !== g; }) }); } }, '×')); })), lab, dl)),
        prop('CC', cc),
        prop('Follow', el('button', { type: 'button', class: 'btn l sm', 'data-follow': '1', onclick: function () { act('follow', { on: !x.following }); } }, x.following ? 'Following · stop' : 'Follow this ticket')),
        prop('Requested', el('div', {}, when(t.created_at))), prop('Last update', el('div', {}, ago(t.updated_at))),
        prop('Merge', mergeArmed ? el('div', {}, el('div', { class: 'm' }, 'Merge #' + t.number + ' into #' + mergeArmed + '? The messages move over and this ticket is closed. This cannot be undone.'), el('button', { type: 'button', class: 'btn sm', 'data-merge-confirm': '1', onclick: function () { var into = mergeArmed; act('merge', { into: into }, 'Merged into #' + into + '.'); } }, 'Yes, merge'), ' ', el('button', { type: 'button', class: 'btn l sm', onclick: function () { mergeArmed = false; draw(); } }, 'Cancel')) : el('div', {}, mergeBox, el('button', { type: 'button', class: 'btn l sm', 'data-merge': '1', onclick: function () { var v = Number(String(mergeBox.value).replace('#', '')); if (!v || v === t.number) return say('Enter the number of another ticket.', true); mergeArmed = v; draw(); } }, 'Merge into…'))));
      var msgs = current.messages.map(function (m) {
        if (m.kind === 'system') return el('div', { class: 'msg-row sys' }, el('span', { class: 'sysmsg', 'data-kind': 'system' }, m.body));
        var side = m.kind === 'requester' ? 'in' : 'out', mine = (m.kind === 'agent' || m.kind === 'note') && m.author_id === meId, editing1 = editMsg === m.id, ed = null, edBox = null;
        if (editing1) { ed = el('textarea', { 'aria-label': 'Edit message' }); ed.value = m.body; edBox = editor(ed, t); }
        return el('div', { class: 'msg-row ' + side }, avatarEl(m.kind, m.author_name, avatarOf(m.author_id)),
          el('div', { class: 'msg-b ' + m.kind, 'data-kind': m.kind }, el('div', { class: 'mh' }, el('strong', {}, m.author_name || (m.kind === 'requester' ? t.requester_email : 'Agent')), el('span', { class: 'm' }, (m.kind === 'note' ? ' · Internal note · ' : ' · ') + when(m.created_at) + (m.edited_at ? ' · edited' : '')), mine && !editing1 ? el('button', { type: 'button', class: 'edit', 'data-edit': String(m.id), onclick: function () { editMsg = m.id; draw(); } }, 'Edit') : null),
            editing1 ? el('div', {}, edBox, el('button', { type: 'button', class: 'btn sm', 'data-edit-save': '1', onclick: function () { api('edit-message', { number: t.number, messageId: m.id, body: ed.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); editMsg = null; return after(); }); } }, 'Save'), ' ', el('button', { type: 'button', class: 'btn l sm', onclick: function () { editMsg = null; draw(); } }, 'Cancel')) : renderBody(m.body),
            translated[m.id] ? el('div', { class: 'tr', 'data-translated': String(m.id) }, el('div', { class: 'm' }, translated[m.id].note), translated[m.id].text ? el('div', { class: 'mt' }, translated[m.id].text) : null) : null,
            m.kind === 'requester' && has('translation') && !translated[m.id] ? el('button', { type: 'button', class: 'edit', 'data-translate': String(m.id), onclick: function () { translate(m); } }, 'Translate') : null,
            (m.attachments || []).length ? el('div', { class: 'files' }, m.attachments.map(function (a) { var u = '/api/attachments/' + encodeURIComponent(a.id) + '?org=' + encodeURIComponent(orgId), pic = /^image\/(png|jpeg|gif|webp)$/.test(a.content_type || a.contentType || ''); return el('span', { class: 'file1' }, pic ? el('a', { href: u, target: '_blank', rel: 'noopener', 'data-thumb': a.id }, el('img', { src: u, alt: a.filename, class: 'thumb', loading: 'lazy' })) : null, el('a', { href: u, 'data-file': a.id, download: a.filename }, a.filename + ' (' + size(a.size) + ')')); })) : null));
      });
      var modeBtn = function (m, label) { return el('button', { type: 'button', role: 'tab', 'data-mode': m, 'aria-selected': String(mode === m), onclick: function () { var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; mode = m; draw(); } }, label); };
      var macroSel = macros.length && mode === 'reply' ? sel('Insert a macro', '', [['', 'Insert a macro…']].concat(macros.map(function (m) { return [String(m.id), m.name]; })), function (v) { var m = macros.filter(function (y) { return String(y.id) === v; })[0]; if (!m) return; var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; var first = String(t.requester_name || '').split(' ')[0] || 'there'; draft = (draft ? draft + '\n\n' : '') + m.body.replace(/\{\{\s*name\s*\}\}/g, first).replace(/\{\{\s*agent\s*\}\}/g, meName); macroPatch = { status: m.status, priority: m.priority, add_tags: m.add_tags }; draw(); }) : null;
      var mentionSel = mode === 'note' && agents.length > 1 ? sel('Mention a teammate', '', [['', '@ Mention a teammate…']].concat(agents.filter(function (a) { return a.id !== meId; }).map(function (a) { return [String(a.email).split('@')[0], a.name || a.email]; })), function (v) { if (!v) return; var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; draft = (draft ? draft + ' ' : '') + '@' + v + ' '; draw(); }) : null;
      var statusSel = sel('Set status when sending', sendStatus, [['', 'Keep status (open becomes pending)'], ['open', 'Send as open'], ['pending', 'Send as pending'], ['solved', 'Send as solved']], function (v) { sendStatus = v; });
      var actions = mode === 'note' ? el('button', { class: 'btn', type: 'button', 'data-note': '1', onclick: function () { send('note'); } }, 'Add internal note') : el('span', { class: 'split' }, el('button', { class: 'btn', type: 'button', 'data-reply': '1', onclick: function () { send('reply'); } }, 'Send reply'), statusSel);
      var center = el('section', { class: 'col conv' }, el('div', { class: 'ch' }, el('h2', {}, '#' + t.number + ' ' + t.subject), el('div', { class: 'm' }, (t.requester_name ? t.requester_name + ' · ' : '') + t.requester_email + ' · ', el('span', { class: 'badge s-' + t.status }, cap(t.status)), t.type && t.type !== 'question' ? ' · ' + cap(t.type) : ''), t.sla ? el('div', { class: 'slas' }, slaChips(t.sla)) : null, t.csat ? el('div', { class: 'm', 'data-csat': t.csat.good ? 'good' : 'bad' }, (t.csat.good ? '👍 Customer rated the support good' : '👎 Customer rated the support bad') + (t.csat.comment ? ': “' + t.csat.comment + '”' : '')) : null),
        el('div', { class: 'thread' }, msgs),
        el('div', { class: 'compose' }, el('div', { class: 'modes', role: 'tablist' }, modeBtn('reply', 'Public reply'), modeBtn('note', 'Internal note'), macroSel, mentionSel), bodyBox, el('div', { class: 'cbar' }, picker(t), el('span', { class: 'hint m' }, 'Ctrl or ⌘ + Enter to send'), actions)));
      // right column: requester, client, linked tickets, side conversations, followers, timeline
      var cards = [el('h3', {}, 'Requester'), el('div', { class: 'pcard' }, el('div', { class: 'row1' }, el('span', { class: 'av in', 'aria-hidden': 'true' }, initial(who)), el('div', {}, el('strong', {}, who), el('div', { class: 'm' }, t.requester_email))), el('div', { class: 'm' }, 'Channel: ' + (t.channel || 'web')))];
      cards.push(el('h3', {}, 'About this client'));
      if (!has('clients')) cards.push(el('div', { class: 'pcard' }, lock('clients')));
      else if (!x.client) cards.push(el('div', { class: 'pcard m' }, 'No client yet. Pick one under Client, or add clients under Manage; a client with a domain picks up its people\'s tickets by itself.'));
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
      var cards = [stat('Open', c.open, { status: 'open', assignee: '', q: '' }, 'data-stat-open'), stat('Pending', c.pending, { status: 'pending', assignee: '', q: '' }, 'data-stat-pending'), stat('Unassigned', c.unassigned, { status: 'active', assignee: 'none', q: '' }, 'data-stat-unassigned'), stat('Assigned to me', c.mine, { status: 'active', assignee: 'me', q: '' }, 'data-stat-mine'),
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
      var statusSel = sel('Submit as', newf.status, [['open', 'Open'], ['pending', 'Pending'], ['solved', 'Solved']], function (v) { newf.status = v; draw(); });
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
    var RULE_ENUM = { priority: ['low', 'normal', 'high', 'urgent'], status: ['open', 'pending', 'solved', 'closed'], channel: ['web', 'email', 'api', 'portal', 'chat'], type: ['question', 'incident', 'problem', 'task'] };
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
          : txt('Action value', a.value, function (x) { a.value = x; }, a.type === 'add_tag' ? 'label' : a.type === 'auto_reply' ? 'Hi {{name}}, thanks for writing…' : 'text');
        return el('div', { class: 'bar', 'data-act': String(i) }, t, v, el('button', { type: 'button', class: 'btn l sm', 'aria-label': 'Remove action', onclick: function () { rd.actions.splice(i, 1); again(); } }, '×'));
      });
      var once = el('input', { type: 'checkbox', 'aria-label': 'Run once per ticket' }); once.checked = rd.once !== false; once.addEventListener('change', function () { rd.once = once.checked; });
      var on = el('input', { type: 'checkbox', 'aria-label': 'Rule is on' }); on.checked = rd.active !== false; on.addEventListener('change', function () { rd.active = on.checked; });
      return el('div', { class: 'mlist' }, el('div', { class: 'page', style: 'padding:12px 0' }, name, ev,
        el('h3', {}, 'If all of these are true'), conds, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn l sm', 'data-cond-add': '1', onclick: function () { if (rd.conditions.length < 8) rd.conditions.push({ field: 'priority', op: 'is', value: 'normal' }); again(); } }, 'Add condition')),
        el('h3', {}, 'Then do'), acts, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn l sm', 'data-act-add': '1', onclick: function () { if (rd.actions.length < 6) rd.actions.push({ type: 'add_tag', value: '' }); again(); } }, 'Add action')),
        el('label', { class: 'm' }, once, ' Run only once per ticket'), el('label', { class: 'm' }, on, ' Rule is on'),
        el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-rule-save': '1', onclick: function () { api('rule-save', rd).then(function (r) { if (!r.ok) return say(r.body.error, true); rd = null; rules = null; say('Automation saved.'); }); } }, 'Save automation'), el('button', { type: 'button', class: 'btn l', onclick: function () { rd = null; again(); } }, 'Cancel'))));
    }
    function managePane() {
      var tabs = [['team', 'Team'], ['queues', 'Queues'], ['clients', 'Clients'], ['macros', 'Macros'], ['sla', 'SLA'], ['triggers', 'Automations'], ['integrations', 'Integrations'], ['api', 'API'], ['fields', 'Fields'], ['chat', 'Live chat'], ['sso', 'Single sign-on'], ['support', 'Support visits']];
      if (support) tabs = tabs.filter(function (t) { return t[0] !== 'support'; });
      var head = el('div', { class: 'mtabs', role: 'tablist' }, tabs.map(function (t) { return el('button', { type: 'button', role: 'tab', 'data-manage-tab': t[0], 'aria-selected': String(manage === t[0]), onclick: function () { manage = t[0]; mEdit = null; draw(); } }, t[1]); }));
      var body, afterSave = function (msg) { return loadInit().then(function () { mEdit = null; say(msg); }); };
      var guardAdmin = !isAdmin ? el('p', { class: 'm' }, 'Only an owner or an admin can change these.') : null;
      if (manage === 'queues') {
        if (!has('queues')) body = lock('queues');
        else { var qn = el('input', { 'aria-label': 'Queue name', placeholder: 'Queue name, for example Billing', maxlength: '60', value: mEdit && mEdit.name || '' });
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Queues sort tickets by team or topic. Tickets can sit in one queue, and the Views tab filters by it.'), queues.map(function (q) { return el('div', { class: 'mitem', 'data-queue-item': String(q.id) }, el('span', { class: 't' }, q.name + ' · ' + q.active + ' active'), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = { id: q.id, name: q.name }; draw(); } }, 'Rename'), el('button', { type: 'button', class: 'btn l sm', 'data-queue-delete': String(q.id), onclick: function () { api('queue-delete', { id: q.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Queue deleted.'); }); } }, 'Delete')) : null); }),
            guardAdmin || el('div', { class: 'bar' }, qn, el('button', { type: 'button', class: 'btn', 'data-queue-save': '1', onclick: function () { api('queue-save', { id: mEdit && mEdit.id, name: qn.value }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Queue saved.'); }); } }, mEdit ? 'Save name' : 'Add queue'))); }
      } else if (manage === 'clients') {
        if (!has('clients')) body = lock('clients');
        else { var e = mEdit || {}, cn = el('input', { 'aria-label': 'Client name', placeholder: 'Client name', maxlength: '100', value: e.name || '' }), cd = el('input', { 'aria-label': 'Client domain', placeholder: 'Their email domain, like acme.com (optional)', maxlength: '100', value: e.domain || '' });
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'A client is a company you support. Give it a domain and tickets from that domain join it automatically.'), clients.map(function (k) { return el('div', { class: 'mitem', 'data-client-item': String(k.id) }, el('span', { class: 't' }, k.name + (k.domain ? ' · @' + k.domain : '') + ' · ' + k.tickets + ' tickets'), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = { id: k.id, name: k.name, domain: k.domain, shareTickets: k.share_tickets }; draw(); } }, 'Edit'), el('button', { type: 'button', class: 'btn l sm', 'data-client-delete': String(k.id), onclick: function () { api('client-delete', { id: k.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Client deleted.'); }); } }, 'Delete')) : null); }),
            guardAdmin || el('div', { class: 'bar' }, cn, cd, el('button', { type: 'button', class: 'btn', 'data-client-save': '1', onclick: function () { api('client-save', { id: e.id, name: cn.value, domain: cd.value, shareTickets: !!e.shareTickets }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Client saved.'); }); } }, e.id ? 'Save client' : 'Add client'))); }
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
          body = el('div', { class: 'mlist' }, el('p', { class: 'm', 'data-seats': '1' }, seatText + ' · ' + (sm.plan ? cap(sm.plan) + ' plan' : '') + (sm.allowed && sm.used >= sm.allowed ? ' · ' : ''), sm.allowed && sm.used >= sm.allowed ? el('a', { href: '/app.html' }, 'Add seats') : null),
            team.people.map(function (p) {
              var mine = p.userId === meId, rs = sel('Role of ' + (p.name || p.email), p.role, team.roles.map(function (x) { return [x, x === 'member' ? 'Agent' : x === 'light' ? 'Light agent (notes only)' : cap(x)]; }), function (v) { api('team-role', { memberId: p.memberId, role: v }).then(function (r) { if (!r.ok) { team = null; return say(r.body.error, true); } reload((p.name || p.email) + ' is now ' + (v === 'member' ? 'an agent' : 'an ' + v) + '.'); }); });
              if (mine) rs.disabled = true;
              var others = team.people.filter(function (x) { return x.userId !== p.userId; });
              var rmBtn = mine ? null : el('button', { type: 'button', class: 'btn l sm', 'data-remove': String(p.memberId), onclick: function () { var to = others.length ? others[0].memberId : ''; var pick = sel('Hand ' + (p.name || p.email) + "'s open tickets to", to, [['', 'Leave them unassigned']].concat(others.map(function (x) { return [x.memberId, x.name || x.email]; })), function (v) { to = v; }); var box = el('div', { class: 'pcard', 'data-remove-box': String(p.memberId) }, el('strong', {}, 'Remove ' + (p.name || p.email) + '?'), el('p', { class: 'm' }, 'They lose access right away. Their ' + p.openTickets + ' open ticket(s) go to:'), pick, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-remove-confirm': '1', onclick: function () { api('team-remove', { memberId: p.memberId, reassignTo: to }).then(function (r) { if (!r.ok) { team = null; return say(r.body.error, true); } reload(p.email + ' was removed.'); }); } }, 'Remove'), el('button', { type: 'button', class: 'btn l', onclick: function () { draw(); } }, 'Cancel'))); var row = main.querySelector('[data-person="' + p.memberId + '"]'); if (row) row.appendChild(box); } }, 'Remove');
              return el('div', { class: 'mitem', 'data-person': String(p.memberId), style: 'flex-wrap:wrap' }, avatarEl('', p.name || p.email, null), el('span', { class: 'grow' }, el('strong', {}, (p.name || p.email) + (mine ? ' (you)' : '')), el('div', { class: 'm' }, p.email + ' · ' + p.openTickets + ' open · last active ' + (p.lastActive ? ago(p.lastActive) : 'never'))), rs, rmBtn);
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
        var ms = sel('Macro status', m.status || '', [['', 'Do not change the status'], ['open', 'Set to open'], ['pending', 'Set to pending'], ['solved', 'Set to solved'], ['closed', 'Set to closed']], function () {}), mp = sel('Macro priority', m.priority || '', [['', 'Do not change the priority'], ['low', 'Set to low'], ['normal', 'Set to normal'], ['high', 'Set to high'], ['urgent', 'Set to urgent']], function () {}), mt = el('input', { 'aria-label': 'Macro labels', placeholder: 'Labels to add, comma separated', value: (m.add_tags || []).join(', ') });
        body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'A macro is a canned reply. Pick it in the reply box; it can also set the status, priority and labels when you send.'), macros.map(function (y) { return el('div', { class: 'mitem', 'data-macro-item': String(y.id) }, el('span', { class: 't' }, y.name), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = y; draw(); } }, 'Edit'), el('button', { type: 'button', class: 'btn l sm', 'data-macro-delete': String(y.id), onclick: function () { api('macro-delete', { id: y.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Macro deleted.'); }); } }, 'Delete')) : null); }),
          guardAdmin || el('div', { class: 'page', style: 'padding:12px 0' }, mn, mb, ms, mp, mt, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-macro-save': '1', onclick: function () { api('macro-save', { id: m.id, name: mn.value, body: mb.value, status: ms.value, priority: mp.value, addTags: mt.value }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Macro saved.'); }); } }, m.id ? 'Save macro' : 'Add macro'), m.id ? el('button', { type: 'button', class: 'btn l', onclick: function () { mEdit = null; draw(); } }, 'Cancel') : null)));
      }
      return el('div', { class: 'page' }, el('h2', {}, 'Manage'), head, body);
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
        f.body = el('textarea', { 'aria-label': 'Article text', placeholder: 'Write the article. # Heading, **bold**, - list, [link](https://…)', rows: '12' }); f.body.value = e.body || '';
        f.pub = el('input', { type: 'checkbox', 'aria-label': 'Published' }); if (e.status === 'published') f.pub.checked = true;
        return el('div', { class: 'page' }, el('h2', {}, isNew ? 'New article' : 'Edit article'), f.title, el('div', { class: 'bar' }, f.lang, f.tr), f.body,
          el('label', { class: 'bar' }, f.pub, ' Published (visible to customers)'),
          el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-article-save': '1', onclick: function () { api('article-save', { id: e.id, title: f.title.value, body: f.body.value, lang: e.lang || 'en', translationOf: e.translationOf || undefined, status: f.pub.checked ? 'published' : 'draft' }).then(function (r) { if (!r.ok) return say(r.body.error, true); editing = null; note = 'Article saved.'; bad = false; return loadArticles(); }); } }, 'Save'),
            !isNew ? el('button', { class: 'btn l', type: 'button', 'data-article-delete': '1', onclick: function () { api('article-delete', { id: e.id }).then(function () { editing = null; return loadArticles(); }); } }, 'Delete') : null,
            el('button', { class: 'btn l', type: 'button', onclick: function () { editing = null; draw(); } }, 'Cancel')));
      }
      return el('div', { class: 'page' }, el('h2', {}, 'Help center'), el('p', { class: 'm' }, 'Public address: /help/' + slug), el('div', { class: 'bar' }, el('a', { class: 'btn l', href: '/help/' + encodeURIComponent(slug), target: '_blank', rel: 'noopener', 'data-view-help': '1' }, 'View the help center'), el('button', { class: 'btn', type: 'button', 'data-article-new': '1', onclick: function () { editing = { lang: 'en' }; draw(); } }, 'New article'), el('button', { class: 'btn l', type: 'button', onclick: function () { articles = null; draw(); } }, 'Close')),
        articles.length ? articles.map(function (a) { return el('button', { class: 'row art', type: 'button', 'data-article': a.id, onclick: function () { api('article-get', { id: a.id }).then(function (r) { if (!r.ok) return say(r.body.error, true); editing = r.body.article; draw(); }); } }, el('b', {}, a.title), el('span', { class: 'm' }, (a.status === 'published' ? 'Published' : 'Draft') + ' · ' + (a.lang === 'es' ? 'Español' : 'English') + ' · ' + a.views + ' views · ' + a.helpful_yes + ' helpful, ' + a.helpful_no + ' not')); }) : el('p', { class: 'm' }, 'No articles yet.'));
    }
    function loadArticles() { return api('article-list').then(function (r) { if (!r.ok) return say(r.body.error, true); closePanes(); articles = r.body.articles; draw(); }); }
    function draw() {
      drawChrome(); drawMenu();
      while (main.firstChild) main.removeChild(main.firstChild);
      if (note) main.appendChild(el('p', { class: 'msg' + (bad ? ' err' : ''), role: 'status' }, note));
      main.appendChild(el('div', { class: 'desk' }, home ? homePane() : profile ? profilePane() : report ? reportPane() : articles ? articlesPane() : settings ? mailPane() : manage ? managePane() : creating ? newPane() : current ? ticketPane() : viewsPane()));
    }
    return boot();
  }
  root.EffDeskDesk = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); }, path: root.location.pathname, replace: function (u) { root.history.replaceState(null, '', u); } });
})(typeof window !== 'undefined' ? window : this);
