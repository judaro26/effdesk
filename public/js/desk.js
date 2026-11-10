// public/js/desk.js: the agent desk, laid out like a help-desk console: an icon rail, ticket tabs along the top, a Views tab with the ticket list and its status filters, and a ticket opened in three columns (properties, conversation with the reply box, requester). Also the Email settings, the Help center and the new-ticket form. Draws text only.
(function (root) {
  'use strict';
  var STATUS = ['active', 'open', 'pending', 'solved', 'closed'];
  var ICONS = { tickets: 'M4 6h16M4 12h16M4 18h16', mail: 'M3 6h18v12H3z M3 7l9 6 9-6', help: 'M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5z M12 6v13', account: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21c0-4 4-6 8-6s8 2 8 6' };
  function start(doc, fetchFn, nav) {
    var main = doc.getElementById('main'), rail = doc.getElementById('rail'), tabsEl = doc.getElementById('tabs'), qBox = doc.getElementById('q'), newBtn = doc.getElementById('newbtn'), orgSlot = doc.getElementById('orgsel');
    var orgId = '', orgs = [], agents = [], list = [], counts = {}, filter = { status: 'active', assignee: '', q: '' }, current = null, note = '', bad = false, creating = false, settings = null, role = '', slug = '', pending = [], articles = null, editing = null, openTabs = [], draft = '', mode = 'reply', me = '';
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
    var closePanes = function () { current = null; creating = false; settings = null; articles = null; editing = null; };

    function boot() {
      return post('/api/me').then(function (r) {
        if (r.status === 401) return nav.go('/auth.html?mode=signin');
        orgs = r.body.organizations; me = r.body.user.email; doc.getElementById('who').textContent = me; doc.getElementById('av').textContent = initial(me);
        var want = new URLSearchParams(nav.search || '').get('org'); var o = orgs.filter(function (x) { return x.id === want; })[0] || orgs[0];
        if (!o) { main.textContent = ''; main.appendChild(el('p', { class: 'pad' }, 'Create an organization first on the ', el('a', { href: '/app.html' }, 'account page'), '.')); return; }
        orgId = o.id; role = o.role; slug = o.slug; return Promise.all([api('agents'), refresh()]).then(function (x) { agents = x[0].body.agents || []; draw(); });
      });
    }
    function refresh() { return api('list', filter).then(function (r) { if (r.ok) { list = r.body.tickets; counts = r.body.counts; } else say(r.body.error || 'That did not work.', true); draw(); }); }
    function open(n) {
      return api('get', { number: n }).then(function (r) {
        if (!r.ok) return say(r.body.error, true);
        if (!current || current.ticket.number !== n) { draft = ''; mode = 'reply'; pending = []; }
        closePanes(); current = r.body;
        var hit = openTabs.filter(function (x) { return x.number === n; })[0]; if (hit) hit.subject = r.body.ticket.subject; else openTabs.push({ number: n, subject: r.body.ticket.subject });
        draw();
      });
    }
    function goViews() { closePanes(); draw(); }
    function search() { filter.q = qBox.value.trim(); closePanes(); refresh(); }
    qBox.addEventListener('keydown', function (e) { if (e.key === 'Enter') search(); });
    newBtn.addEventListener('click', function () { closePanes(); creating = true; draw(); });

    // ── chrome: the rail and the tabs ──
    function drawChrome() {
      var where = articles ? 'help' : settings ? 'mail' : 'tickets';
      var item = function (name, label, data, onclick) { var b = el('button', { type: 'button', class: 'ri', 'aria-label': label, title: label, 'aria-current': String(where === name) }, icon(name)); b.setAttribute(data, '1'); b.addEventListener('click', onclick); return b; };
      while (rail.firstChild) rail.removeChild(rail.firstChild);
      rail.appendChild(el('a', { class: 'logo', href: '/', 'aria-label': 'EffDesk home', title: 'EffDesk' }, 'E'));
      rail.appendChild(item('tickets', 'Tickets', 'data-nav', goViews));
      rail.appendChild(item('mail', 'Email settings', 'data-mail', function () { api('mail-get').then(function (r) { if (!r.ok) return say(r.body.error, true); closePanes(); settings = r.body; draw(); }); }));
      rail.appendChild(item('help', 'Help center', 'data-help', loadArticles));
      rail.appendChild(el('span', { class: 'grow' }));
      var acct = el('a', { class: 'ri', href: '/app.html', 'aria-label': 'Account', title: 'Account' }, icon('account')); rail.appendChild(acct);
      while (tabsEl.firstChild) tabsEl.removeChild(tabsEl.firstChild);
      var onViews = !current && !creating && !settings && !articles;
      tabsEl.appendChild(el('button', { type: 'button', role: 'tab', class: 'tab', 'data-views': '1', 'aria-selected': String(onViews), onclick: goViews }, 'Views'));
      openTabs.forEach(function (t) {
        var on = !!current && current.ticket.number === t.number;
        tabsEl.appendChild(el('span', { class: 'tab has-x', 'aria-selected': String(on) },
          el('button', { type: 'button', role: 'tab', 'data-tab': String(t.number), 'aria-selected': String(on), onclick: function () { open(t.number); } }, '#' + t.number + ' ' + t.subject),
          el('button', { type: 'button', class: 'x', 'data-close': String(t.number), 'aria-label': 'Close #' + t.number, onclick: function () { openTabs = openTabs.filter(function (x) { return x.number !== t.number; }); if (current && current.ticket.number === t.number) current = null; draw(); } }, '×')));
      });
      while (orgSlot.firstChild) orgSlot.removeChild(orgSlot.firstChild);
      if (orgs.length > 1) orgSlot.appendChild(sel('Organization', orgId, orgs.map(function (o) { return [o.id, o.name]; }), function (v) { orgId = v; closePanes(); openTabs = []; Promise.all([api('agents'), refresh()]).then(function (x) { agents = x[0].body.agents || []; draw(); }); }));
    }

    // ── Views: filters and the ticket table ──
    function viewsPane() {
      var n = function (s) { return s === 'active' ? (counts.open || 0) + (counts.pending || 0) : counts[s]; };
      var filters = STATUS.map(function (s) { return el('button', { type: 'button', class: 'flt', 'data-status': s, 'aria-pressed': String(filter.status === s), onclick: function () { filter.status = s; refresh(); } }, el('span', {}, s === 'active' ? 'Active' : cap(s)), el('span', { class: 'n' }, n(s) != null ? String(n(s)) : '')); });
      filters.push(el('button', { type: 'button', class: 'flt', 'data-mine': '1', 'aria-pressed': String(filter.assignee === 'me'), onclick: function () { filter.assignee = filter.assignee === 'me' ? '' : 'me'; refresh(); } }, el('span', {}, 'Assigned to me')));
      var name = function (id) { var a = agents.filter(function (x) { return x.id === id; })[0]; return a ? (a.name || a.email) : ''; };
      var rows = list.map(function (t) {
        var tr = el('tr', { class: 'row', tabindex: '0', 'data-number': String(t.number), 'aria-current': String(!!current && current.ticket.number === t.number) },
          el('td', {}, el('span', { class: 'badge s-' + t.status }, cap(t.status))), el('td', { class: 'num' }, '#' + t.number), el('td', { class: 'subj' }, t.subject), el('td', {}, t.requester_name || t.requester_email), el('td', {}, cap(t.priority)), el('td', {}, name(t.assignee_id) || '—'), el('td', { class: 'when' }, ago(t.updated_at)));
        tr.addEventListener('click', function () { open(t.number); }); tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(t.number); });
        return tr;
      });
      return el('div', { class: 'views' }, el('div', { class: 'side' }, el('h3', {}, 'Tickets'), el('div', { class: 'flts', role: 'group', 'aria-label': 'Status' }, filters)),
        el('div', { class: 'tbl' }, list.length ? el('table', {}, el('thead', {}, el('tr', {}, ['Status', 'Ticket', 'Subject', 'Requester', 'Priority', 'Assignee', 'Updated'].map(function (h) { return el('th', {}, h); }))), el('tbody', {}, rows)) : el('p', { class: 'm pad' }, 'No tickets here.')));
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
      var t = current.ticket, body = el('textarea', { 'aria-label': 'Message', placeholder: mode === 'note' ? 'Write an internal note. Only your team sees it.' : 'Write a public reply. The customer is emailed.' });
      body.value = draft; body.addEventListener('input', function () { draft = body.value; });
      var update = function (patch) { api('update', { number: t.number, patch: patch }).then(function (r) { if (!r.ok) return say(r.body.error, true); return Promise.all([open(t.number), refresh()]); }); };
      var send = function (action, status) { draft = body.value; if (!body.value.trim()) return say('Write a message first.', true); var ids = action === 'reply' ? pending.map(function (p) { return p.id; }) : []; api(action, { number: t.number, body: body.value, status: status, attachmentIds: ids }).then(function (r) { if (!r.ok) return say(r.body.error, true); var n = ''; if (r.body.email === 'failed') n = 'Saved, but the email could not be sent. Try again later.'; else if (r.body.email === 'skipped') n = r.body.emailWhy === 'no-inbox' ? 'Saved, but no email was sent: set up your support address under Email settings.' : r.body.emailWhy === 'limit' ? 'Saved, but no email was sent: you reached today\'s email limit for your plan.' : ''; pending = []; draft = ''; return Promise.all([open(t.number), refresh()]).then(function () { if (n) say(n, true); }); }); };
      body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send(mode === 'note' ? 'note' : 'reply'); });
      var tags = el('input', { 'aria-label': 'Tags', value: t.tags.join(', '), placeholder: 'tags, comma separated' }); tags.addEventListener('change', function () { update({ tags: tags.value }); });
      var who = t.requester_name || t.requester_email;
      var props = el('aside', { class: 'col props', 'aria-label': 'Ticket properties' },
        prop('Requester', el('div', {}, who)),
        prop('Assignee', sel('Assignee', t.assignee_id || '', [['', 'Unassigned']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { update({ assigneeId: v || null }); })),
        prop('Priority', el('div', {}, sel('Priority', t.priority, [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], function (v) { update({ priority: v }); }), t.priority === 'low' || t.priority === 'normal' ? el('button', { type: 'button', class: 'btn l sm', 'data-escalate': '1', onclick: function () { update({ priority: 'high' }); } }, 'Escalate to high') : null)),
        prop('Status', sel('Status', t.status, [['open', 'Open'], ['pending', 'Pending'], ['solved', 'Solved'], ['closed', 'Closed']], function (v) { update({ status: v }); })),
        prop('Tags', tags), prop('Subject', el('div', {}, t.subject)), prop('Requested', el('div', {}, when(t.created_at))), prop('Last update', el('div', {}, ago(t.updated_at))));
      var msgs = current.messages.map(function (m) {
        var side = m.kind === 'requester' ? 'in' : 'out';
        return el('div', { class: 'msg-row ' + side }, el('span', { class: 'av ' + m.kind, 'aria-hidden': 'true' }, initial(m.author_name)),
          el('div', { class: 'msg-b ' + m.kind, 'data-kind': m.kind }, el('div', { class: 'mh' }, el('strong', {}, m.author_name || (m.kind === 'requester' ? t.requester_email : 'Agent')), el('span', { class: 'm' }, (m.kind === 'note' ? ' · Internal note · ' : ' · ') + when(m.created_at))), el('div', { class: 'mt' }, m.body),
            (m.attachments || []).length ? el('div', { class: 'files' }, m.attachments.map(function (a) { return el('a', { href: '/api/attachments/' + encodeURIComponent(a.id) + '?org=' + encodeURIComponent(orgId), 'data-file': a.id, download: a.filename }, a.filename + ' (' + size(a.size) + ')'); })) : null));
      });
      var modeBtn = function (m, label) { return el('button', { type: 'button', role: 'tab', 'data-mode': m, 'aria-selected': String(mode === m), onclick: function () { var ta = main.querySelector('textarea'); if (ta) draft = ta.value; mode = m; draw(); } }, label); };
      var actions = mode === 'note' ? el('button', { class: 'btn', type: 'button', 'data-note': '1', onclick: function () { send('note'); } }, 'Add internal note') : el('span', { class: 'split' }, el('button', { class: 'btn', type: 'button', 'data-reply': '1', onclick: function () { send('reply'); } }, 'Send reply'), el('button', { class: 'btn l', type: 'button', 'data-solve': '1', onclick: function () { send('reply', 'solved'); } }, 'Send and solve'));
      var center = el('section', { class: 'col conv' }, el('div', { class: 'ch' }, el('h2', {}, '#' + t.number + ' ' + t.subject), el('div', { class: 'm' }, (t.requester_name ? t.requester_name + ' · ' : '') + t.requester_email + ' · ', el('span', { class: 'badge s-' + t.status }, cap(t.status)))),
        el('div', { class: 'thread' }, msgs),
        el('div', { class: 'compose' }, el('div', { class: 'modes', role: 'tablist' }, modeBtn('reply', 'Public reply'), modeBtn('note', 'Internal note')), body, el('div', { class: 'cbar' }, picker(t), el('span', { class: 'hint m' }, 'Ctrl or ⌘ + Enter to send'), actions)));
      var side = el('aside', { class: 'col info', 'aria-label': 'Requester' }, el('h3', {}, 'Requester'), el('div', { class: 'pcard' }, el('div', { class: 'row1' }, el('span', { class: 'av in', 'aria-hidden': 'true' }, initial(who)), el('div', {}, el('strong', {}, who), el('div', { class: 'm' }, t.requester_email))), el('div', { class: 'm' }, 'Channel: ' + (t.channel || 'web'))),
        el('h3', {}, 'This ticket'), el('div', { class: 'pcard m' }, el('div', {}, 'Opened ' + when(t.created_at)), t.first_response_at ? el('div', {}, 'First reply ' + when(t.first_response_at)) : el('div', {}, 'No reply yet'), t.solved_at ? el('div', {}, 'Solved ' + when(t.solved_at)) : null, el('div', {}, current.messages.length + ' message' + (current.messages.length === 1 ? '' : 's'))));
      return el('div', { class: 'ticket' }, props, center, side);
    }
    function field(k, ph) { return el('input', { 'aria-label': k, placeholder: ph, maxlength: '200' }); }
    function newPane() {
      var f = { subject: field('subject', 'Subject'), requesterName: field('requesterName', 'Requester name'), requesterEmail: field('requesterEmail', 'Requester email') };
      var body = el('textarea', { 'aria-label': 'First message', placeholder: 'What is the request?' });
      return el('div', { class: 'page' }, el('h2', {}, 'New ticket'), f.subject, f.requesterName, f.requesterEmail, body, el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-create': '1', onclick: function () { api('create', { subject: f.subject.value, requesterName: f.requesterName.value, requesterEmail: f.requesterEmail.value, body: body.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); note = ''; return Promise.all([open(r.body.ticket.number), refresh()]); }); } }, 'Create ticket'), el('button', { class: 'btn l', type: 'button', onclick: function () { creating = false; draw(); } }, 'Cancel')));
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
      drawChrome();
      while (main.firstChild) main.removeChild(main.firstChild);
      if (note) main.appendChild(el('p', { class: 'msg' + (bad ? ' err' : ''), role: 'status' }, note));
      main.appendChild(el('div', { class: 'desk' }, articles ? articlesPane() : settings ? mailPane() : creating ? newPane() : current ? ticketPane() : viewsPane()));
    }
    return boot();
  }
  root.EffDeskDesk = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); } });
})(typeof window !== 'undefined' ? window : this);
