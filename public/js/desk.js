// public/js/desk.js: the agent desk, laid out like a help-desk console: an icon rail, ticket tabs, a Views tab with filters, queues and saved views, a ticket in three columns (properties, conversation, requester/client/linked/side conversations/timeline), Manage (queues, clients, macros), Email settings, Help center, and the profile menu with themes. Draws text only.
(function (root) {
  'use strict';
  var STATUS = ['active', 'open', 'pending', 'solved', 'closed'];
  var ICONS = { home: 'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10', tickets: 'M4 6h16M4 12h16M4 18h16', mail: 'M3 6h18v12H3z M3 7l9 6 9-6', help: 'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z M12 6v13', manage: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6', reports: 'M4 20V11M10 20V4M16 20v-8M22 20H2', account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6' };
  // preview colours for the theme cards: [rail, background, panel, accent]; the real look is in desk.css
  var THEMES = [
    { id: 'classic', name: 'Classic', blurb: 'The familiar help-desk look: teal rail, blue accents. Follows your device light or dark setting.', sw: ['#03363d', '#f4f5f7', '#ffffff', '#1f73b7'] },
    { id: 'midnight', name: 'Midnight', blurb: 'Always dark and easy on the eyes.', sw: ['#090c10', '#0f1318', '#171c23', '#f4a030'], },
    { id: 'aurora', name: 'Aurora', pro: true, blurb: 'Deep indigo with a violet and cyan glow.', sw: ['#3a22a0', '#0c0a1d', '#1a1640', '#8b7bff'] },
    { id: 'sunset', name: 'Sunset', pro: true, blurb: 'Warm cream, coral and plum.', sw: ['#ec4a6c', '#fff4ec', '#fffdfb', '#ec4a6c'] },
    { id: 'forest', name: 'Forest', pro: true, blurb: 'Calm greens with a touch of gold.', sw: ['#245c43', '#eef3ea', '#fbfdf8', '#d4a72c'] },
    { id: 'ocean', name: 'Ocean', pro: true, blurb: 'Crisp blues and clear aqua.', sw: ['#0f4cc0', '#ecf4fb', '#ffffff', '#0aa8cc'] },
    { id: 'orchid', name: 'Orchid', pro: true, blurb: 'Rich plum with pink and violet.', sw: ['#6a1f8c', '#190f20', '#28172f', '#ff6ec7'] }
  ];
  var PLAN_OF = { queues: 'Team', clients: 'Team', linked_tickets: 'Team', saved_views: 'Team', themes: 'Team', side_conversations: 'Suite', translation: 'Suite', sla: 'Team', reports: 'Team' };
  function start(doc, fetchFn, nav) {
    var main = doc.getElementById('main'), rail = doc.getElementById('rail'), tabsEl = doc.getElementById('tabs'), qBox = doc.getElementById('q'), newBtn = doc.getElementById('newbtn'), orgSlot = doc.getElementById('orgsel'), userBtn = doc.getElementById('userbtn'), userMenu = doc.getElementById('usermenu');
    var orgId = '', orgs = [], agents = [], list = [], counts = {}, filter = { status: 'active', assignee: '', q: '' }, current = null, note = '', bad = false, creating = false, settings = null, role = '', slug = '', pending = [], articles = null, editing = null, openTabs = [], draft = '', mode = 'reply', me = '', meId = '', meName = '';
    var home = true, dash = null, features = [], queues = [], clients = [], macros = [], views = [], labels = [], isAdmin = false, theme = 'classic', manage = '', profile = false, report = null, reportDays = 30, translated = {}, notify = true, sla = null, editMsg = null, mergeArmed = false, macroPatch = null, sendStatus = '', savingView = false, menuOpen = false, mEdit = null;
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else if (k === 'value') e.value = props[k]; else e.setAttribute(k, props[k]); }); [].concat.apply([], [].slice.call(arguments, 2)).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
    var icon = function (name) { var ns = 'http://www.w3.org/2000/svg', s = doc.createElementNS(ns, 'svg'), p = doc.createElementNS(ns, 'path'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '1.8'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round'); s.setAttribute('aria-hidden', 'true'); p.setAttribute('d', ICONS[name]); s.appendChild(p); return s; };
    var post = function (path, body) { return fetchFn(path, { method: path === '/api/me' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: path === '/api/me' ? undefined : JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var api = function (action, extra) { return post('/api/tickets', Object.assign({ orgId: orgId, action: action }, extra || {})); };
    var say = function (t, isBad) { note = t; bad = !!isBad; draw(); };
    var size = function (n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
    var when = function (s) { try { return new Date(s).toLocaleString(); } catch (e) { return String(s); } };
    var ago = function (s) { var m = Math.round((Date.now() - new Date(s).getTime()) / 60000); if (!isFinite(m)) return ''; if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; if (m < 1440) return Math.round(m / 60) + ' h ago'; return Math.round(m / 1440) + ' d ago'; };
    var cap = function (s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; };
    var initial = function (s) { return (String(s || '?').trim()[0] || '?').toUpperCase(); };
    var has = function (f) { return features.indexOf(f) >= 0; };
    var dur = function (ms) { var m = Math.max(0, Math.round(ms / 60000)); return m < 60 ? m + ' min' : m < 2880 ? (Math.round(m / 6) / 10) + ' h' : Math.round(m / 1440) + ' d'; };
    var minsText = function (m) { return m === null || m === undefined ? '—' : dur(m * 60000); };
    var slaText = function (t) { if (!t) return ''; if (t.state === 'met') return 'met'; if (t.state === 'missed') return 'missed'; var d = t.due - Date.now(); return d < 0 ? 'breached ' + dur(-d) + ' ago' : 'due in ' + dur(d); };
    var slaChips = function (s) { return s ? [s.first ? el('span', { class: 'sla s-' + s.first.state, 'data-sla': 'first' }, 'First reply ' + slaText(s.first)) : null, s.resolve ? el('span', { class: 'sla s-' + s.resolve.state, 'data-sla': 'resolve' }, 'Solve ' + slaText(s.resolve)) : null] : []; };
    var lock = function (f) { return el('span', { class: 'lock', 'data-lock': f }, 'Part of the ' + PLAN_OF[f] + ' plan. ', el('a', { href: '/app.html' }, 'Upgrade')); };
    var closePanes = function () { home = false; current = null; creating = false; settings = null; articles = null; editing = null; manage = ''; profile = false; report = null; mergeArmed = false; editMsg = null; };
    var noteFrom = function (r) { return say(r.body.error || 'That did not work.', true); };

    function applyTheme(id) { theme = id; doc.documentElement.setAttribute('data-theme', id); try { root.localStorage.setItem('eff_theme', id); } catch (e) { /* storage may be blocked */ } }
    function boot() {
      return post('/api/me').then(function (r) {
        if (r.status === 401) return nav.go('/auth.html?mode=signin');
        orgs = r.body.organizations; me = r.body.user.email; meId = r.body.user.id; meName = r.body.user.name || me; doc.getElementById('who').textContent = me; doc.getElementById('av').textContent = initial(me);
        var want = new URLSearchParams(nav.search || '').get('org'); var o = orgs.filter(function (x) { return x.id === want; })[0] || orgs[0];
        if (!o) { main.textContent = ''; main.appendChild(el('p', { class: 'pad' }, 'Create an organization first on the ', el('a', { href: '/app.html' }, 'account page'), '.')); return; }
        orgId = o.id; role = o.role; slug = o.slug; var tn = Number(new URLSearchParams(nav.search || '').get('ticket')); return loadInit().then(refresh).then(function () { if (tn > 0) return open(tn); return goHome(); });
      });
    }
    function loadInit() { return api('init').then(function (r) { if (!r.ok) return; var b = r.body; agents = b.agents || []; features = b.features || []; queues = b.queues || []; clients = b.clients || []; macros = b.macros || []; views = b.views || []; labels = b.labels || []; isAdmin = !!b.admin; notify = b.notify !== false; sla = b.sla || null; if (b.theme) applyTheme(b.theme); }); }
    function refresh() { return api('list', filter).then(function (r) { if (r.ok) { list = r.body.tickets; counts = r.body.counts; } else say(r.body.error || 'That did not work.', true); draw(); }); }
    function open(n) {
      return api('get', { number: n }).then(function (r) {
        if (!r.ok) return say(r.body.error, true);
        if (!current || current.ticket.number !== n) { draft = ''; mode = 'reply'; pending = []; macroPatch = null; sendStatus = ''; }
        closePanes(); current = r.body;
        var hit = openTabs.filter(function (x) { return x.number === n; })[0]; if (hit) hit.subject = r.body.ticket.subject; else openTabs.push({ number: n, subject: r.body.ticket.subject });
        draw();
      });
    }
    function goViews() { closePanes(); draw(); }
    function goHome() { closePanes(); home = true; return api('dashboard').then(function (r) { dash = r.ok ? r.body : null; if (!r.ok) say(r.body.error || 'That did not work.', true); else draw(); }); }
    function search() { filter.q = qBox.value.trim(); closePanes(); refresh(); }
    qBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    newBtn.addEventListener('click', function () { closePanes(); creating = true; draw(); });

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
      var rows = list.map(function (t) {
        var tags = (t.tags || []).map(function (g) { return el('button', { type: 'button', class: 'tag', 'data-tag': g, onclick: function (e) { e.stopPropagation(); filter = { status: '', assignee: '', q: '', tag: g }; refresh(); } }, g); });
        var tr = el('tr', { class: 'row', tabindex: '0', 'data-number': String(t.number), 'aria-current': String(!!current && current.ticket.number === t.number) },
          el('td', {}, el('span', { class: 'badge s-' + t.status }, cap(t.status))), el('td', { class: 'num' }, '#' + t.number), el('td', { class: 'subj' }, t.subject, tags.length ? el('span', { class: 'tagline' }, tags) : null), el('td', {}, t.requester_name || t.requester_email), el('td', {}, cap(t.priority)), el('td', {}, name(t.assignee_id) || '—'), has('sla') ? el('td', {}, t.sla && t.sla.worst !== 'ok' && t.sla.worst !== 'met' ? el('span', { class: 'sla s-' + t.sla.worst, 'data-sla-row': t.sla.worst }, t.sla.worst === 'breached' ? 'Breached' : t.sla.worst === 'missed' ? 'Missed' : 'At risk') : '') : null, el('td', { class: 'when' }, ago(t.updated_at)));
        tr.addEventListener('click', function () { open(t.number); }); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(t.number); });
        return tr;
      });
      return el('div', { class: 'views' }, side, el('div', { class: 'tbl' }, list.length ? el('table', {}, el('thead', {}, el('tr', {}, ['Status', 'Ticket', 'Subject', 'Requester', 'Priority', 'Assignee'].concat(has('sla') ? ['SLA'] : [], ['Updated']).map(function (h) { return el('th', {}, h); }))), el('tbody', {}, rows)) : el('p', { class: 'm pad' }, 'No tickets here.')));
    }

    function picker(t) {
      var input = el('input', { type: 'file', multiple: 'multiple', 'aria-label': 'Attach files', 'data-attach': '1' });
      input.addEventListener('change', function () {
        var files = [].slice.call(input.files || []).slice(0, 5 - pending.length), next = Promise.resolve();
        files.forEach(function (f) { next = next.then(function () {
          if (f.size > 5 * 1024 * 1024) return say(f.name + ' is over 5 MB.', true);
          return fetchFn('/api/attachments?org=' + encodeURIComponent(orgId) + '&ticket=' + t.number + '&name=' + encodeURIComponent(f.name) + '&type=' + encodeURIComponent(f.type || 'application/octet-stream'), { method: 'POST', credentials: 'same-origin', body: f }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) return say(j.error || 'That file could not be uploaded.', true); pending.push(j.attachment); }); });
        }); });
        next.then(function () { draw(); });
      });
      return el('span', { class: 'attach' }, el('label', { class: 'btn l sm' }, 'Attach', input), pending.map(function (p) { return el('span', { class: 'chip', 'data-pending': p.id }, p.filename + ' (' + size(p.size) + ') ', el('button', { type: 'button', 'aria-label': 'Remove ' + p.filename, onclick: function () { pending = pending.filter(function (x) { return x.id !== p.id; }); api('delete-file', { id: p.id }); draw(); } }, '×')); }));
    }
    function sel(label, value, opts, onchange) { var s = el('select', { 'aria-label': label }, opts.map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === value) op.setAttribute('selected', 'selected'); return op; })); s.value = value; s.addEventListener('change', function () { onchange(s.value); }); return s; }
    var prop = function (label, child) { return el('div', { class: 'prop' }, el('div', { class: 'pl' }, label), child); };

    // ── a ticket in three columns ──
    function ticketPane() {
      var t = current.ticket, x = current.extras || { followers: [], events: [], sides: [], incidents: [], merged: [] }, body = el('textarea', { 'aria-label': 'Message', placeholder: mode === 'note' ? 'Write an internal note. Only your team sees it.' : 'Write a public reply. The customer is emailed.' });
      body.value = draft; body.addEventListener('input', function () { draft = body.value; });
      var after = function () { return Promise.all([open(t.number), refresh()]); };
      var update = function (patch) { return api('update', { number: t.number, patch: patch }).then(function (r) { if (!r.ok) return say(r.body.error, true); return after(); }); };
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
        var side = m.kind === 'requester' ? 'in' : 'out', mine = (m.kind === 'agent' || m.kind === 'note') && m.author_id === meId, editing1 = editMsg === m.id, ed = null;
        if (editing1) { ed = el('textarea', { 'aria-label': 'Edit message' }); ed.value = m.body; }
        return el('div', { class: 'msg-row ' + side }, el('span', { class: 'av ' + m.kind, 'aria-hidden': 'true' }, initial(m.author_name)),
          el('div', { class: 'msg-b ' + m.kind, 'data-kind': m.kind }, el('div', { class: 'mh' }, el('strong', {}, m.author_name || (m.kind === 'requester' ? t.requester_email : 'Agent')), el('span', { class: 'm' }, (m.kind === 'note' ? ' · Internal note · ' : ' · ') + when(m.created_at) + (m.edited_at ? ' · edited' : '')), mine && !editing1 ? el('button', { type: 'button', class: 'edit', 'data-edit': String(m.id), onclick: function () { editMsg = m.id; draw(); } }, 'Edit') : null),
            editing1 ? el('div', {}, ed, el('button', { type: 'button', class: 'btn sm', 'data-edit-save': '1', onclick: function () { api('edit-message', { number: t.number, messageId: m.id, body: ed.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); editMsg = null; return after(); }); } }, 'Save'), ' ', el('button', { type: 'button', class: 'btn l sm', onclick: function () { editMsg = null; draw(); } }, 'Cancel')) : el('div', { class: 'mt' }, m.body),
            translated[m.id] ? el('div', { class: 'tr', 'data-translated': String(m.id) }, el('div', { class: 'm' }, translated[m.id].note), translated[m.id].text ? el('div', { class: 'mt' }, translated[m.id].text) : null) : null,
            m.kind === 'requester' && has('translation') && !translated[m.id] ? el('button', { type: 'button', class: 'edit', 'data-translate': String(m.id), onclick: function () { translate(m); } }, 'Translate') : null,
            (m.attachments || []).length ? el('div', { class: 'files' }, m.attachments.map(function (a) { return el('a', { href: '/api/attachments/' + encodeURIComponent(a.id) + '?org=' + encodeURIComponent(orgId), 'data-file': a.id, download: a.filename }, a.filename + ' (' + size(a.size) + ')'); })) : null));
      });
      var modeBtn = function (m, label) { return el('button', { type: 'button', role: 'tab', 'data-mode': m, 'aria-selected': String(mode === m), onclick: function () { var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; mode = m; draw(); } }, label); };
      var macroSel = macros.length && mode === 'reply' ? sel('Insert a macro', '', [['', 'Insert a macro…']].concat(macros.map(function (m) { return [String(m.id), m.name]; })), function (v) { var m = macros.filter(function (y) { return String(y.id) === v; })[0]; if (!m) return; var ta = main.querySelector('.compose textarea'); if (ta) draft = ta.value; var first = String(t.requester_name || '').split(' ')[0] || 'there'; draft = (draft ? draft + '\n\n' : '') + m.body.replace(/\{\{\s*name\s*\}\}/g, first).replace(/\{\{\s*agent\s*\}\}/g, meName); macroPatch = { status: m.status, priority: m.priority, add_tags: m.add_tags }; draw(); }) : null;
      var statusSel = sel('Set status when sending', sendStatus, [['', 'Keep status (open becomes pending)'], ['open', 'Send as open'], ['pending', 'Send as pending'], ['solved', 'Send as solved']], function (v) { sendStatus = v; });
      var actions = mode === 'note' ? el('button', { class: 'btn', type: 'button', 'data-note': '1', onclick: function () { send('note'); } }, 'Add internal note') : el('span', { class: 'split' }, el('button', { class: 'btn', type: 'button', 'data-reply': '1', onclick: function () { send('reply'); } }, 'Send reply'), statusSel);
      var center = el('section', { class: 'col conv' }, el('div', { class: 'ch' }, el('h2', {}, '#' + t.number + ' ' + t.subject), el('div', { class: 'm' }, (t.requester_name ? t.requester_name + ' · ' : '') + t.requester_email + ' · ', el('span', { class: 'badge s-' + t.status }, cap(t.status)), t.type && t.type !== 'question' ? ' · ' + cap(t.type) : ''), t.sla ? el('div', { class: 'slas' }, slaChips(t.sla)) : null),
        el('div', { class: 'thread' }, msgs),
        el('div', { class: 'compose' }, el('div', { class: 'modes', role: 'tablist' }, modeBtn('reply', 'Public reply'), modeBtn('note', 'Internal note'), macroSel), body, el('div', { class: 'cbar' }, picker(t), el('span', { class: 'hint m' }, 'Ctrl or ⌘ + Enter to send'), actions)));
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
        el('div', { class: 'stats' }, cards), setup, el('div', { class: 'rgrid' }, list('Assigned to you', dash.mine, 'Nothing is waiting on you.', 'data-list-mine'), list('Needs an owner', dash.unassigned, 'Every active ticket has an owner.', 'data-list-unassigned')));
    }
    function location_go(u) { nav.go(u); }
    function reportPane() {
      if (report.locked) return el('div', { class: 'page' }, el('h2', {}, 'Reports'), el('div', { class: 'pcard' }, el('p', {}, 'See volume, response times, who solved what and SLA results, and download the tickets as a spreadsheet.'), lock('reports')));
      var r = report, top = Math.max.apply(null, [1].concat(r.perDay.map(function (d) { return Math.max(d.created, d.solved); })));
      var stat = function (label, value, sub) { return el('div', { class: 'stat' }, el('div', { class: 'sv' }, value), el('div', { class: 'sl' }, label), sub ? el('div', { class: 'm' }, sub) : null); };
      var range = sel('Report range', String(reportDays), [['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']], function (v) { reportDays = Number(v); loadReport(); });
      var chart = el('div', { class: 'chart', role: 'img', 'aria-label': 'Tickets created and solved per day: ' + r.perDay.reduce(function (a, d) { return a + d.created; }, 0) + ' created, ' + r.perDay.reduce(function (a, d) { return a + d.solved; }, 0) + ' solved' }, r.perDay.map(function (d) { return el('span', { class: 'day', title: d.day + ': ' + d.created + ' created, ' + d.solved + ' solved' }, el('i', { class: 'c', style: 'height:' + Math.round(100 * d.created / top) + '%' }), el('i', { class: 's', style: 'height:' + Math.round(100 * d.solved / top) + '%' })); }));
      return el('div', { class: 'page wide' }, el('div', { class: 'bar' }, el('h2', {}, 'Reports'), el('span', { class: 'grow' }), range, el('button', { type: 'button', class: 'btn l', 'data-report-csv': '1', onclick: function () { api('report-csv', { days: reportDays }).then(function (x) { if (!x.ok) return say(x.body.error, true); var u = root.URL.createObjectURL(new root.Blob([x.body.csv], { type: 'text/csv' })), a = doc.createElement('a'); a.href = u; a.download = x.body.filename; doc.body.appendChild(a); a.click(); doc.body.removeChild(a); setTimeout(function () { root.URL.revokeObjectURL(u); }, 1000); }); } }, 'Download CSV')),
        el('div', { class: 'stats' }, stat('Tickets created', String(r.total), r.truncated ? 'Showing the latest 5,000' : ''), stat('First reply, average', minsText(r.firstReply.avgMin), 'median ' + minsText(r.firstReply.medianMin) + ' · ' + r.firstReply.answered + ' answered'), stat('Time to solve, average', minsText(r.resolution.avgMin), 'median ' + minsText(r.resolution.medianMin) + ' · ' + r.resolution.solved + ' solved'), r.sla ? stat('SLA met', r.sla.rate === null ? '—' : r.sla.rate + '%', r.sla.breached + ' breached or missed') : null),
        el('div', { class: 'rcard' }, el('h3', {}, 'Created and solved per day'), chart, el('div', { class: 'legend m' }, el('span', { class: 'k c' }), ' Created ', el('span', { class: 'k s' }), ' Solved')),
        el('div', { class: 'rgrid' }, hlist('By status', r.byStatus), hlist('By priority', r.byPriority), hlist('By channel', r.byChannel), hlist('By type', r.byType), hlist('By queue', r.byQueue), hlist('Solved by', r.solvedBy), hlist('Busiest labels', r.labels)));
    }
    function field(k, ph) { return el('input', { 'aria-label': k, placeholder: ph, maxlength: '200' }); }
    function newPane() {
      var f = { subject: field('subject', 'Subject'), requesterName: field('requesterName', 'Requester name'), requesterEmail: field('requesterEmail', 'Requester email') };
      var body = el('textarea', { 'aria-label': 'First message', placeholder: 'What is the request?' });
      return el('div', { class: 'page' }, el('h2', {}, 'New ticket'), f.subject, f.requesterName, f.requesterEmail, body, el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-create': '1', onclick: function () { api('create', { subject: f.subject.value, requesterName: f.requesterName.value, requesterEmail: f.requesterEmail.value, body: body.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); note = ''; return Promise.all([open(r.body.ticket.number), refresh(), loadInit()]); }); } }, 'Create ticket'), el('button', { class: 'btn l', type: 'button', onclick: function () { creating = false; draw(); } }, 'Cancel')));
    }

    // ── Manage: queues, clients and macros ──
    function managePane() {
      var tabs = [['queues', 'Queues'], ['clients', 'Clients'], ['macros', 'Macros'], ['sla', 'SLA']];
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
      } else if (manage === 'sla') {
        if (!has('sla')) body = lock('sla');
        else { var P = ['low', 'normal', 'high', 'urgent'], inputs = {}, hrs = function (v) { return v ? String(Math.round(v / 6) / 10) : ''; };
          P.forEach(function (p) { var cur = (sla || {})[p] || {}; inputs[p] = { f: el('input', { 'aria-label': cap(p) + ' first reply in hours', inputmode: 'decimal', placeholder: 'none', value: hrs(cur.firstResponseMin) }), r: el('input', { 'aria-label': cap(p) + ' solve in hours', inputmode: 'decimal', placeholder: 'none', value: hrs(cur.resolveMin) }) }; });
          var toMin = function (v) { var n = parseFloat(String(v).replace(',', '.')); return String(v).trim() === '' ? null : Math.round(n * 60); };
          body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'Set how many hours the team has, counted around the clock from when a ticket is created. A ticket is at risk when 80% of the time is used, and breached when it runs out. Leave a box empty for no target.'),
            el('table', { class: 'slatable' }, el('thead', {}, el('tr', {}, el('th', {}, 'Priority'), el('th', {}, 'First reply within (hours)'), el('th', {}, 'Solved within (hours)'))), el('tbody', {}, P.map(function (p) { return el('tr', {}, el('td', {}, cap(p)), el('td', {}, inputs[p].f), el('td', {}, inputs[p].r)); }))),
            guardAdmin || el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-sla-save': '1', onclick: function () { var pol = {}; P.forEach(function (p) { pol[p] = { firstResponseMin: toMin(inputs[p].f.value), resolveMin: toMin(inputs[p].r.value) }; }); api('sla-save', { policies: pol }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('SLA targets saved.'); }); } }, 'Save targets'))); }
      } else {
        var m = mEdit || {}, mn = el('input', { 'aria-label': 'Macro name', placeholder: 'Macro name, for example Thanks and solve', maxlength: '80', value: m.name || '' }), mb = el('textarea', { 'aria-label': 'Macro text', placeholder: 'The reply. Use {{name}} for the requester\'s first name and {{agent}} for you.' }); mb.value = m.body || '';
        var ms = sel('Macro status', m.status || '', [['', 'Do not change the status'], ['open', 'Set to open'], ['pending', 'Set to pending'], ['solved', 'Set to solved'], ['closed', 'Set to closed']], function () {}), mp = sel('Macro priority', m.priority || '', [['', 'Do not change the priority'], ['low', 'Set to low'], ['normal', 'Set to normal'], ['high', 'Set to high'], ['urgent', 'Set to urgent']], function () {}), mt = el('input', { 'aria-label': 'Macro labels', placeholder: 'Labels to add, comma separated', value: (m.add_tags || []).join(', ') });
        body = el('div', { class: 'mlist' }, el('p', { class: 'm' }, 'A macro is a canned reply. Pick it in the reply box; it can also set the status, priority and labels when you send.'), macros.map(function (y) { return el('div', { class: 'mitem', 'data-macro-item': String(y.id) }, el('span', { class: 't' }, y.name), isAdmin ? el('span', { class: 'acts' }, el('button', { type: 'button', class: 'btn l sm', onclick: function () { mEdit = y; draw(); } }, 'Edit'), el('button', { type: 'button', class: 'btn l sm', 'data-macro-delete': String(y.id), onclick: function () { api('macro-delete', { id: y.id }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Macro deleted.'); }); } }, 'Delete')) : null); }),
          guardAdmin || el('div', { class: 'page', style: 'padding:12px 0' }, mn, mb, ms, mp, mt, el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn', 'data-macro-save': '1', onclick: function () { api('macro-save', { id: m.id, name: mn.value, body: mb.value, status: ms.value, priority: mp.value, addTags: mt.value }).then(function (r) { if (!r.ok) return noteFrom(r); return afterSave('Macro saved.'); }); } }, m.id ? 'Save macro' : 'Add macro'), m.id ? el('button', { type: 'button', class: 'btn l', onclick: function () { mEdit = null; draw(); } }, 'Cancel') : null)));
      }
      return el('div', { class: 'page' }, el('h2', {}, 'Manage'), head, body);
    }

    // ── profile and themes ──
    function profilePane() {
      var nb = el('input', { type: 'checkbox', 'aria-label': 'Email me about my tickets', 'data-notify': '1' }); nb.checked = notify; nb.addEventListener('change', function () { var want = nb.checked; api('prefs-save', { notify: want }).then(function (r) { if (!r.ok) { nb.checked = notify; return say(r.body.error, true); } notify = want; say(want ? 'Notification emails on.' : 'Notification emails off.'); }); });
      var cards = THEMES.map(function (t) {
        var locked = !!t.pro && !has('themes');
        var b = el('button', { type: 'button', class: 'theme', 'data-theme-id': t.id, 'aria-pressed': String(theme === t.id), 'aria-disabled': String(locked), 'aria-label': t.name + ' theme' + (locked ? ' (paid plans)' : '') },
          el('span', { class: 'sw' }, el('i', { style: 'background:' + t.sw[0] }), el('b', { style: 'background:' + t.sw[1] }, el('em', { style: 'background:' + t.sw[2] + ';width:80%;border:1px solid rgba(127,127,127,.3)' }), el('em', { style: 'background:' + t.sw[2] + ';width:60%;border:1px solid rgba(127,127,127,.3)' }), el('em', { style: 'background:' + t.sw[3] + ';width:34%' }))),
          el('span', { class: 'nm' }, t.name), el('span', { class: 'm', style: 'display:block' }, t.blurb), t.pro ? el('span', { class: 'pro' }, 'PRO') : null);
        b.addEventListener('click', function () { if (locked) return say('The ' + t.name + ' theme comes with the ' + PLAN_OF.themes + ' plan and above. Upgrade on the account page to use it.', true); var prev = theme; applyTheme(t.id); api('prefs-save', { theme: t.id }).then(function (r) { if (!r.ok) { applyTheme(prev); return say(r.body.error, true); } note = t.name + ' theme on.'; bad = false; draw(); }); });
        return b;
      });
      return el('div', { class: 'page' }, el('h2', {}, 'Profile and themes'), el('div', { class: 'pcard', style: 'width:100%;max-width:520px' }, el('div', { class: 'row1' }, el('span', { class: 'av', 'aria-hidden': 'true' }, initial(me)), el('div', {}, el('strong', {}, meName), el('div', { class: 'm' }, me)))), el('h3', {}, 'Email notifications'), el('label', { class: 'bar' }, nb, ' Email me when a customer replies on a ticket I own or follow, and when a ticket is assigned to me'), el('h3', {}, 'Theme'), el('p', { class: 'm' }, 'Pick how your desk looks. It follows you on every device. Classic and Midnight are on every plan' + (has('themes') ? '; the PRO themes are yours too.' : '; the PRO themes come with paid plans.')), el('div', { class: 'themes' }, cards), !has('themes') ? lock('themes') : null);
    }
    function mailPane() {
      var m = settings, f = {};
      f.inbox = el('input', { 'aria-label': 'Support address', value: m.inbox || m.suggestedInbox, maxlength: '32' });
      f.mode = sel('Replies', m.replyMode, [['ticket', 'Customer replies come back into the ticket'], ['custom', 'Customer replies go to my own address'], ['none', 'No-reply: customers cannot reply']], function (v) { m.replyMode = v; m.inbox = f.inbox.value; m.fromName = f.fromName.value; m.signature = f.sig.value; m.replyTo = f.replyTo.value; draw(); });
      f.replyTo = el('input', { 'aria-label': 'Reply-to address', type: 'email', placeholder: 'support@yourcompany.com', value: m.replyTo || '' });
      f.fromName = el('input', { 'aria-label': 'Sender name', placeholder: 'Sender name (for example Acme Support)', value: m.fromName || '', maxlength: '100' });
      f.sig = el('textarea', { 'aria-label': 'Signature', placeholder: 'Signature added to every reply', maxlength: '1000' }); f.sig.value = m.signature || '';
      var ro = role === 'owner' || role === 'admin';
      return el('div', { class: 'page' }, el('h2', {}, 'Email settings'),
        el('p', { class: 'm' }, 'Customers write to ' + (m.inbox || m.suggestedInbox) + '@' + m.domain + '. Forward your existing support mailbox there to bring that mail in too.'),
        el('div', { class: 'bar' }, f.inbox, el('span', { class: 'm' }, '@' + m.domain)), el('div', { class: 'bar' }, f.mode), m.replyMode === 'custom' ? el('div', { class: 'bar' }, f.replyTo) : null,
        el('div', { class: 'bar' }, f.fromName), f.sig,
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
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); } });
})(typeof window !== 'undefined' ? window : this);
