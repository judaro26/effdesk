// public/js/desk.js: the agent desk: ticket list with search and status tabs, a ticket with its conversation, reply and internal note, status, priority, assignee, tags, and a form for a new ticket. Draws text only.
(function (root) {
  'use strict';
  var STATUS = ['active', 'open', 'pending', 'solved', 'closed'];
  function start(doc, fetchFn, nav) {
    var main = doc.getElementById('main'), orgId = '', orgs = [], agents = [], list = [], counts = {}, filter = { status: 'active', assignee: '', q: '' }, current = null, note = '', bad = false, creating = false, settings = null, role = '', pending = [];
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else if (k === 'value') e.value = props[k]; else e.setAttribute(k, props[k]); }); [].concat.apply([], [].slice.call(arguments, 2)).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
    var post = function (path, body) { return fetchFn(path, { method: path === '/api/me' ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: path === '/api/me' ? undefined : JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var api = function (action, extra) { return post('/api/tickets', Object.assign({ orgId: orgId, action: action }, extra || {})); };
    var say = function (t, isBad) { note = t; bad = !!isBad; draw(); };
    var size = function (n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; };
    var when = function (s) { try { return new Date(s).toLocaleString(); } catch (e) { return String(s); } };
    function boot() {
      return post('/api/me').then(function (r) {
        if (r.status === 401) return nav.go('/auth.html?mode=signin');
        orgs = r.body.organizations; doc.getElementById('who').textContent = r.body.user.email;
        var want = new URLSearchParams(nav.search || '').get('org'); var o = orgs.filter(function (x) { return x.id === want; })[0] || orgs[0];
        if (!o) { main.textContent = ''; main.appendChild(el('p', {}, 'Create an organization first on the ', el('a', { href: '/app.html' }, 'account page'), '.')); return; }
        orgId = o.id; role = o.role; return Promise.all([api('agents'), refresh()]).then(function (x) { agents = x[0].body.agents || []; draw(); });
      });
    }
    function refresh() { return api('list', filter).then(function (r) { if (r.ok) { list = r.body.tickets; counts = r.body.counts; } else say(r.body.error || 'That did not work.', true); draw(); }); }
    function open(n) { pending = []; return api('get', { number: n }).then(function (r) { if (!r.ok) return say(r.body.error, true); current = r.body; creating = false; settings = null; draw(); }); }
    function listPane() {
      var q = el('input', { type: 'search', 'aria-label': 'Search tickets', placeholder: 'Search subject, person or #', value: filter.q });
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { filter.q = q.value.trim(); refresh(); } });
      var tabs = el('div', { class: 'tabs', role: 'group', 'aria-label': 'Status' }, STATUS.map(function (s) { return el('button', { type: 'button', 'data-status': s, 'aria-pressed': String(filter.status === s), onclick: function () { filter.status = s; refresh(); } }, s === 'active' ? 'Active' : s[0].toUpperCase() + s.slice(1) + (counts[s] != null ? ' ' + counts[s] : '')); }));
      var mine = el('button', { type: 'button', 'data-mine': '1', 'aria-pressed': String(filter.assignee === 'me'), onclick: function () { filter.assignee = filter.assignee === 'me' ? '' : 'me'; refresh(); } }, 'Mine');
      tabs.appendChild(mine);
      var rows = list.length ? list.map(function (t) { return el('button', { class: 'row', type: 'button', 'data-number': String(t.number), 'aria-current': String(!!current && current.ticket.number === t.number), onclick: function () { open(t.number); } }, el('b', {}, '#' + t.number + ' ' + t.subject), el('span', { class: 'm' }, t.status + ' · ' + t.priority + ' · ' + (t.requester_name || t.requester_email))); }) : [el('p', { class: 'm' }, 'No tickets here.')];
      return el('div', { class: 'card' }, el('button', { class: 'btn', type: 'button', 'data-new': '1', onclick: function () { creating = true; current = null; draw(); } }, 'New ticket'), el('div', { style: 'margin-top:8px' }, q), tabs, el('div', {}, rows));
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
      return el('div', {}, input, pending.map(function (p) { return el('span', { class: 'chip', 'data-pending': p.id }, p.filename + ' (' + size(p.size) + ') ', el('button', { type: 'button', 'aria-label': 'Remove ' + p.filename, onclick: function () { pending = pending.filter(function (x) { return x.id !== p.id; }); api('delete-file', { id: p.id }); draw(); } }, '×')); }));
    }
    function sel(label, value, opts, onchange) { var s = el('select', { 'aria-label': label }, opts.map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === value) op.setAttribute('selected', 'selected'); return op; })); s.value = value; s.addEventListener('change', function () { onchange(s.value); }); return s; }
    function ticketPane() {
      var t = current.ticket, body = el('textarea', { 'aria-label': 'Message', placeholder: 'Write a reply or an internal note…' });
      var update = function (patch) { api('update', { number: t.number, patch: patch }).then(function (r) { if (!r.ok) return say(r.body.error, true); return Promise.all([open(t.number), refresh()]); }); };
      var send = function (action, status) { if (!body.value.trim()) return say('Write a message first.', true); var ids = action === 'reply' ? pending.map(function (p) { return p.id; }) : []; api(action, { number: t.number, body: body.value, status: status, attachmentIds: ids }).then(function (r) { if (!r.ok) return say(r.body.error, true); var n = ''; if (r.body.email === 'failed') n = 'Saved, but the email could not be sent. Try again later.'; else if (r.body.email === 'skipped') n = r.body.emailWhy === 'no-inbox' ? 'Saved, but no email was sent: set up your support address under Email settings.' : r.body.emailWhy === 'limit' ? 'Saved, but no email was sent: you reached today\'s email limit for your plan.' : ''; pending = []; return Promise.all([open(t.number), refresh()]).then(function () { if (n) say(n, true); }); }); };
      var tags = el('input', { 'aria-label': 'Tags', value: t.tags.join(', '), placeholder: 'tags, comma separated' }); tags.addEventListener('change', function () { update({ tags: tags.value }); });
      return el('div', { class: 'card' }, el('h2', {}, '#' + t.number + ' ' + t.subject), el('p', { class: 'm' }, (t.requester_name ? t.requester_name + ' · ' : '') + t.requester_email + ' · opened ' + when(t.created_at)),
        el('div', { class: 'bar' }, sel('Status', t.status, [['open', 'Open'], ['pending', 'Pending'], ['solved', 'Solved'], ['closed', 'Closed']], function (v) { update({ status: v }); }),
          sel('Priority', t.priority, [['low', 'Low'], ['normal', 'Normal'], ['high', 'High'], ['urgent', 'Urgent']], function (v) { update({ priority: v }); }),
          sel('Assignee', t.assignee_id || '', [['', 'Unassigned']].concat(agents.map(function (a) { return [a.id, a.name || a.email]; })), function (v) { update({ assigneeId: v || null }); }), tags),
        current.messages.map(function (m) { return el('div', { class: 'msg-b ' + m.kind, 'data-kind': m.kind }, el('div', { class: 'm' }, (m.kind === 'note' ? 'Internal note · ' : '') + m.author_name + ' · ' + when(m.created_at)), el('div', {}, m.body), (m.attachments || []).length ? el('div', { class: 'files' }, m.attachments.map(function (a) { return el('a', { href: '/api/attachments/' + encodeURIComponent(a.id) + '?org=' + encodeURIComponent(orgId), 'data-file': a.id, download: a.filename }, a.filename + ' (' + size(a.size) + ')'); })) : null); }),
        body, picker(t), el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-reply': '1', onclick: function () { send('reply'); } }, 'Reply'), el('button', { class: 'btn', type: 'button', 'data-solve': '1', onclick: function () { send('reply', 'solved'); } }, 'Reply and solve'), el('button', { class: 'btn l', type: 'button', 'data-note': '1', onclick: function () { send('note'); } }, 'Add internal note')));
    }
    function newPane() {
      var f = {}; ['subject', 'requesterName', 'requesterEmail'].forEach(function (k) { f[k] = el('input', { 'aria-label': k, placeholder: { subject: 'Subject', requesterName: 'Requester name', requesterEmail: 'Requester email' }[k], maxlength: '200' }); });
      var body = el('textarea', { 'aria-label': 'First message', placeholder: 'What is the request?' });
      return el('div', { class: 'card' }, el('h2', {}, 'New ticket'), f.subject, ' ', f.requesterName, ' ', f.requesterEmail, body, el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-create': '1', onclick: function () { api('create', { subject: f.subject.value, requesterName: f.requesterName.value, requesterEmail: f.requesterEmail.value, body: body.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); note = ''; return Promise.all([open(r.body.ticket.number), refresh()]); }); } }, 'Create ticket'), el('button', { class: 'btn l', type: 'button', onclick: function () { creating = false; draw(); } }, 'Cancel')));
    }
    function mailPane() {
      var m = settings, f = {};
      f.inbox = el('input', { 'aria-label': 'Support address', value: m.inbox || m.suggestedInbox, maxlength: '32' });
      f.mode = sel('Replies', m.replyMode, [['ticket', 'Customer replies come back into the ticket'], ['custom', 'Customer replies go to my own address'], ['none', 'No-reply: customers cannot reply']], function (v) { m.replyMode = v; m.inbox = f.inbox.value; m.fromName = f.fromName.value; m.signature = f.sig.value; m.replyTo = f.replyTo.value; draw(); });
      f.replyTo = el('input', { 'aria-label': 'Reply-to address', type: 'email', placeholder: 'support@yourcompany.com', value: m.replyTo || '' });
      f.fromName = el('input', { 'aria-label': 'Sender name', placeholder: 'Sender name (for example Acme Support)', value: m.fromName || '', maxlength: '100' });
      f.sig = el('textarea', { 'aria-label': 'Signature', placeholder: 'Signature added to every reply', maxlength: '1000' }); f.sig.value = m.signature || '';
      var ro = role === 'owner' || role === 'admin';
      return el('div', { class: 'card' }, el('h2', {}, 'Email settings'),
        el('p', { class: 'm' }, 'Customers write to ' + (m.inbox || m.suggestedInbox) + '@' + m.domain + '. Forward your existing support mailbox there to bring that mail in too.'),
        el('div', { class: 'bar' }, f.inbox, el('span', { class: 'm' }, '@' + m.domain)), el('div', { class: 'bar' }, f.mode), m.replyMode === 'custom' ? el('div', { class: 'bar' }, f.replyTo) : null,
        el('div', { class: 'bar' }, f.fromName), f.sig,
        ro ? el('div', { class: 'bar' }, el('button', { class: 'btn', type: 'button', 'data-mail-save': '1', onclick: function () { api('mail-save', { inbox: f.inbox.value, replyMode: m.replyMode, replyTo: f.replyTo.value, fromName: f.fromName.value, signature: f.sig.value }).then(function (r) { if (!r.ok) return say(r.body.error, true); settings = r.body; say('Email settings saved.'); }); } }, 'Save'), el('button', { class: 'btn l', type: 'button', onclick: function () { settings = null; draw(); } }, 'Close')) : el('p', { class: 'm' }, 'Only an owner or an admin can change these.'));
    }
    function draw() {
      while (main.firstChild) main.removeChild(main.firstChild);
      if (note) main.appendChild(el('p', { class: 'msg' + (bad ? ' err' : ''), role: 'status' }, note));
      var orgSel = orgs.length > 1 ? sel('Organization', orgId, orgs.map(function (o) { return [o.id, o.name]; }), function (v) { orgId = v; current = null; Promise.all([api('agents'), refresh()]).then(function (x) { agents = x[0].body.agents || []; draw(); }); }) : null;
      main.appendChild(el('h1', {}, 'Tickets')); if (orgSel) main.appendChild(orgSel);
      main.appendChild(el('p', {}, el('button', { class: 'btn l', type: 'button', 'data-mail': '1', onclick: function () { api('mail-get').then(function (r) { if (!r.ok) return say(r.body.error, true); settings = r.body; current = null; creating = false; draw(); }); } }, 'Email settings')));
      main.appendChild(el('div', { class: 'desk' }, listPane(), settings ? mailPane() : creating ? newPane() : current ? ticketPane() : el('div', { class: 'card' }, el('p', { class: 'm' }, 'Pick a ticket, or create a new one.'))));
    }
    return boot();
  }
  root.EffDeskDesk = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); } });
})(typeof window !== 'undefined' ? window : this);
