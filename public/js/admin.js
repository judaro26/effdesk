// public/js/admin.js: THE PLATFORM OWNER'S CONSOLE (shell, overview, customers, licences, import; the other tools are in admin-panels.js). Give or take back a lifetime licence, and import the old desk's data (the export file of the mdv console) in batches. The server refuses anyone who is not the platform owner. Draws text only.
(function (root) {
  'use strict';
  var BATCH = 100;
  function start(doc, fetchFn) {
    var main = doc.getElementById('main'), log = null, people = null, detail = null, filt = 'all', q = '';
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else if (typeof props[k] === 'boolean' && k in e) e[k] = props[k]; else e.setAttribute(k, props[k]); }); var append = function (c) { if (c == null || c === false) return; if (Array.isArray(c)) { c.forEach(append); return; } if (typeof c === 'string' || typeof c === 'number') c = doc.createTextNode(String(c)); e.appendChild(c); }; [].slice.call(arguments, 2).forEach(append); return e; };
    var call = function (method, path, body) { return fetchFn(path, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var say = function (t, bad) { if (!log) return; log.textContent = t; log.className = 'msg' + (bad ? ' err' : ''); };
    function readJsonFile(file) { return new Promise(function (res, rej) { var fr = new root.FileReader(); fr.onload = function () { try { res(JSON.parse(fr.result)); } catch (e) { rej(new Error('That file is not valid JSON.')); } }; fr.onerror = function () { rej(new Error('That file could not be read.')); }; fr.readAsText(file); }); }
    function runImport(slug, file, dryRun) {
      return readJsonFile(file).then(function (data) {
        var tickets = data.tickets || [], articles = data.articles || [], n = Math.max(Math.ceil(tickets.length / BATCH), Math.ceil(articles.length / BATCH), 1), tot = { t: 0, te: 0, ts: 0, m: 0, a: 0, ae: 0, as: 0, f: 0, w: [] }, i = 0;
        var next = function () {
          if (i >= n) return tot;
          var body = { orgSlug: slug, dryRun: dryRun, data: { tickets: tickets.slice(i * BATCH, (i + 1) * BATCH), articles: articles.slice(i * BATCH, (i + 1) * BATCH) } };
          say((dryRun ? 'Checking' : 'Importing') + ' batch ' + (i + 1) + ' of ' + n + '…');
          return call('POST', '/api/import', body).then(function (r) {
            if (!r.ok) throw new Error(r.body.error || 'The import stopped (batch ' + (i + 1) + ').');
            var b = r.body; tot.t += b.tickets.added; tot.te += b.tickets.existing; tot.ts += b.tickets.skipped; tot.m += b.messages; tot.a += b.articles.added; tot.ae += b.articles.existing; tot.as += b.articles.skipped; tot.f += b.filesNotCopied; tot.w = tot.w.concat(b.warnings); i++; return next();
          });
        };
        return next();
      });
    }
    var ago = function (v) { if (!v) return 'never'; var d = Math.round((Date.now() - new Date(v).getTime()) / 86400000); return d < 1 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
    var HEALTH = { healthy: 'Healthy', free: 'Free', heavy: 'Heavy use', stalled: 'Stalled', past_due: 'Past due', canceled: 'Canceled' };
    var SECTIONS = [['Monitor', [['overview', 'Overview'], ['performance', 'Performance & health'], ['customers', 'Customers'], ['errors', 'Errors'], ['status', 'Status page']]], ['Manage', [['licence', 'Lifetime licences'], ['users', 'People'], ['settings', 'Settings']]], ['Platform', [['logging', 'Logging'], ['activity', 'Activity']]], ['Data', [['import', 'Import old desk']]]], section = 'overview';
    var act = function (action, body) { return call('POST', '/api/admin/do', Object.assign({ action: action }, body || {})).catch(function () { return { ok: false, status: 0, body: { error: 'The server could not be reached.' } }; }); };
    var P = root.EffDeskAdminPanels ? root.EffDeskAdminPanels.make({ el: el, act: act, say: function (t, b) { say(t, b); }, doc: doc }) : null;
    var ids = []; SECTIONS.forEach(function (g) { g[1].forEach(function (x) { ids.push(x[0]); }); });
    var fromHash = function () { var h = String(root.location && root.location.hash || '').replace('#', ''); return ids.indexOf(h) >= 0 ? h : 'overview'; };
    var needsAttention = function (c) { return c.health === 'past_due' || c.health === 'stalled'; };
    function show(id) {
      section = id; [].slice.call(doc.querySelectorAll('[data-panel]')).forEach(function (p) { p.hidden = p.getAttribute('data-panel') !== id; });
      [].slice.call(doc.querySelectorAll('[data-nav]')).forEach(function (a) { if (a.getAttribute('data-nav') === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
      if (P && P.panels[id]) P.panels[id].load();
    }
    function tile(label, value, tone) { return el('div', { class: 'tile' + (tone ? ' ' + tone : '') }, el('div', { class: 'tv' }, String(value)), el('div', { class: 'tl' }, label)); }
    function overviewPanel() {
      var box = el('div', {}, el('h2', {}, 'Overview'));
      if (!people) return box.appendChild(el('p', { class: 'm' }, 'Loading…')), box;
      if (people.error) return box.appendChild(el('p', { class: 'msg err', role: 'alert', 'data-customers-error': '1' }, people.error)), box;
      var t = people.totals;
      box.appendChild(el('div', { class: 'tiles', 'data-totals': '1' }, tile('Organizations', t.organizations), tile('Paying', t.paying), tile('Agents', t.agents), tile('Tickets, last 30 days', t.tickets30), tile('Past due', t.pastDue, t.pastDue ? 'warn' : ''), tile('Stalled', t.stalled, t.stalled ? 'warn' : ''), tile('Heavy use', t.heavy)));
      var att = people.customers.filter(needsAttention);
      box.appendChild(el('h3', { style: 'margin-top:24px' }, 'Needs attention'));
      box.appendChild(att.length ? el('ul', { class: 't', 'data-attention': '1' }, att.map(function (c) { return el('li', {}, el('strong', {}, c.name), ' ', el('span', { class: 'm' }, c.slug + ' · ' + (HEALTH[c.health] || c.health) + ' · last active ' + ago(c.lastActive))); })) : el('p', { class: 'm' }, 'Nothing needs attention right now.'));
      if (P) box.insertBefore(P.health(), box.children[1] || null);
      return box;
    }
    function customersCard() {
      if (detail) return detailCard();
      var box = el('div', { 'data-customers': '1' }, el('h2', {}, 'Customers'));
      if (!people) { box.appendChild(el('p', { class: 'm' }, 'Loading…')); return box; }
      if (people.error) { box.appendChild(el('p', { class: 'msg err', role: 'alert' }, people.error)); return box; }
      var fs = el('select', { 'aria-label': 'Show' }, [['all', 'All'], ['paying', 'Paying'], ['free', 'Free'], ['attention', 'Needs attention'], ['past_due', 'Past due'], ['stalled', 'Stalled'], ['heavy', 'Heavy use'], ['canceled', 'Canceled']].map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === filt) op.selected = true; return op; }));
      fs.addEventListener('change', function () { filt = fs.value; drawList(); syncTabs(); });
      var tabs = el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Customer groups' }, [['all', 'All'], ['paying', 'Paying'], ['free', 'Free'], ['attention', 'Needs attention']].map(function (o) { return el('button', { type: 'button', role: 'tab', class: 'subtab', 'data-subtab': o[0], onclick: function () { filt = o[0]; fs.value = o[0]; drawList(); syncTabs(); } }, o[1]); }));
      var qb = el('input', { 'aria-label': 'Search customers', placeholder: 'Search name, address or owner', value: q }); qb.addEventListener('input', function () { q = qb.value; drawList(); });
      box.appendChild(tabs);
      box.appendChild(el('div', { class: 'bar' }, fs, ' ', qb, ' ', el('a', { class: 'btn l', href: '/api/admin/customers?format=csv', 'data-customers-csv': '1' }, 'Download CSV')));
      box.appendChild(el('div', { id: 'custlist', class: 'tablewrap' })); return box;
    }
    function openCustomer(slug) { call('GET', '/api/admin/customer?slug=' + encodeURIComponent(slug)).then(function (r) { if (!r.ok) return say(r.body.error || 'That customer could not be loaded.', true); detail = r.body; draw(); show('customers'); }); }
    function chart(usage, key, label) {
      var max = Math.max.apply(null, usage.map(function (u) { return u[key]; }).concat([1]));
      return el('div', { class: 'chart', role: 'img', 'aria-label': label + ' per day for the last 30 days' }, usage.map(function (u) { return el('span', { class: 'bar1', style: 'height:' + Math.max(2, Math.round(u[key] / max * 100)) + '%', title: u.day + ': ' + u[key] }); }));
    }
    function detailCard() {
      var d = detail, b = d.billing, box = el('div', { 'data-detail': d.customer.slug });
      box.appendChild(el('button', { type: 'button', class: 'btn l', 'data-detail-back': '1', onclick: function () { detail = null; draw(); show('customers'); } }, '← All customers'));
      box.appendChild(el('h2', { style: 'margin-top:14px' }, d.customer.name, ' ', el('span', { class: 'm' }, d.customer.slug)));
      if (d.flags.length) box.appendChild(el('ul', { class: 't', 'data-flags': '1' }, d.flags.map(function (f) { return el('li', { class: 'msg err' }, f.text); })));
      box.appendChild(el('div', { class: 'tiles' }, tile('Plan', b.plan + (b.status !== 'none' && b.status !== 'licence' ? ' (' + b.status + ')' : '')), tile('Seats used', b.seatsUsed + (b.seatLimit ? ' of ' + b.seatLimit : ' (no limit)')), tile('Tickets, 30 days', d.totals.tickets), tile('Replies, 30 days', d.totals.replies), tile('API calls, 30 days', d.totals.apiCalls)));
      box.appendChild(el('p', { class: 'm' }, 'Billing: ' + (b.interval ? 'billed per ' + b.interval + ', ' : '') + (b.seatsPaid ? b.seatsPaid + ' seats paid, ' : '') + (b.renews ? 'renews ' + new Date(b.renews).toLocaleDateString() : 'no renewal date')));
      box.appendChild(el('h3', { style: 'margin-top:20px' }, 'Usage, last 30 days'));
      box.appendChild(d.usage.length ? el('div', { class: 'charts' }, el('div', {}, el('div', { class: 'm' }, 'Tickets'), chart(d.usage, 'tickets', 'Tickets')), el('div', {}, el('div', { class: 'm' }, 'Replies'), chart(d.usage, 'replies', 'Replies')), el('div', {}, el('div', { class: 'm' }, 'API calls'), chart(d.usage, 'api_calls', 'API calls'))) : el('p', { class: 'm' }, 'No usage recorded yet. It is summarised every hour.'));
      box.appendChild(el('h3', { style: 'margin-top:20px' }, 'Who has access'));
      box.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'adtable', 'data-people': '1' }, el('thead', {}, el('tr', {}, ['Name', 'Email', 'Role', 'Last active'].map(function (x) { return el('th', { scope: 'col' }, x); }))), el('tbody', {}, d.people.map(function (p) { return el('tr', {}, el('td', {}, p.name || ''), el('td', {}, p.email), el('td', {}, p.role), el('td', {}, ago(p.lastActive))); })))));
      box.appendChild(el('h3', { style: 'margin-top:20px' }, 'Support view'));
      box.appendChild(el('p', {}, el('a', { class: 'btn', href: '/desk.html?org=' + encodeURIComponent(d.customer.id) + '&support=1', 'data-open-support': '1' }, 'Open support view (read-only)'), ' ', el('span', { class: 'm' }, 'Read-only. Each visit is recorded in the customer\u2019s audit log.')));
      box.appendChild(el('h3', { style: 'margin-top:20px' }, 'Sandbox environment'));
      box.appendChild(el('p', { class: 'm' }, 'Create a separate workspace for safe testing. It copies the customer’s current workspace members and roles, but does not copy production tickets, contacts, integrations, credentials or billing.'));
      box.appendChild(el('button', { type: 'button', class: 'btn', 'data-create-sandbox': d.customer.slug, onclick: function (ev) {
        var btn = ev.currentTarget; if (root.confirm && !root.confirm('Create an isolated sandbox for ' + d.customer.name + '?')) return;
        btn.disabled = true; btn.textContent = 'Creating sandbox…';
        act('customer-sandbox-create', { slug: d.customer.slug }).then(function (r) {
          btn.disabled = false; btn.textContent = 'Create / verify sandbox';
          if (!r.ok) return say(r.body.error || 'The sandbox could not be created.', true);
          var s = r.body.sandbox, note = box.querySelector('[data-sandbox-result]');
          if (!note) { note = el('p', { class: 'msg', 'data-sandbox-result': '1' }); box.appendChild(note); }
          note.textContent = (r.body.existing ? 'Sandbox already exists: ' : 'Sandbox created: ') + s.name + ' (' + s.slug + '). ' + r.body.members + ' team members have access. They can sign in normally and choose this workspace from the workspace switcher.';
        }).catch(function () { btn.disabled = false; btn.textContent = 'Create / verify sandbox'; say('The server could not be reached.', true); });
      } }, 'Create / verify sandbox'));
      if (P) { box.appendChild(el('h3', { style: 'margin-top:20px' }, 'Settings for this customer')); box.appendChild(P.customerControls(d.customer.slug)); }
      if (d.entries.length) box.appendChild(el('ul', { class: 't' }, d.entries.map(function (e) { return el('li', { class: 'm' }, new Date(e.at).toLocaleString() + ' · ' + e.action.replace('support.', '').replace('-', ' ') + ' · ' + (e.who || '')); })));
      return box;
    }
    function syncTabs() { [].slice.call(doc.querySelectorAll('[data-subtab]')).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-subtab') === filt ? 'true' : 'false'); }); }
    function drawList() {
      var host = doc.getElementById('custlist'); if (!host || !people) return; while (host.firstChild) host.removeChild(host.firstChild);
      var rows = people.customers.filter(function (c) { var h = c.health; return (filt === 'all' || (filt === 'paying' ? c.plan !== 'free' && c.status !== 'canceled' && c.status !== 'none' : filt === 'free' ? c.plan === 'free' : filt === 'attention' ? needsAttention(c) : h === filt)) && (!q || (c.name + ' ' + c.slug + ' ' + (c.owner || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0); });
      var th = function (x) { return el('th', { scope: 'col' }, x); }, td = function (x) { return el('td', {}, x); };
      var tb = el('table', { class: 'adtable' }, el('thead', {}, el('tr', {}, ['Customer', 'Owner', 'Plan', 'Agents', 'Tickets 30d', 'Total', 'Last active', 'Health'].map(th))),
        el('tbody', {}, rows.map(function (c) { return el('tr', { 'data-org': c.slug }, td(el('span', {}, el('button', { type: 'button', class: 'linkbtn', 'data-open-customer': c.slug, onclick: function () { openCustomer(c.slug); } }, c.name), ' ', el('span', { class: 'm' }, c.slug))), td(c.owner || ''), td(c.plan + (c.status && c.status !== 'none' && c.status !== 'licence' ? ' (' + c.status + ')' : '') + (c.seatsPaid ? ' · ' + c.seatsPaid + ' seats' : '')), td(String(c.agents) + (c.invites ? ' (+' + c.invites + ' invited)' : '')), td(String(c.tickets.last30)), td(String(c.tickets.total)), td(ago(c.lastActive)), td(el('span', { class: 'pill ' + c.health }, HEALTH[c.health] || c.health))); })));
      host.appendChild(rows.length ? tb : el('p', { class: 'm' }, 'No customers match.'));
    }
    function draw() {
      while (main.firstChild) main.removeChild(main.firstChild);
      var slug = el('input', { 'aria-label': 'Organization slug', placeholder: 'organization slug, for example mdv', maxlength: '60' }), note = el('input', { 'aria-label': 'Note', placeholder: 'note (for example: mdv, our own company)', maxlength: '200' });
      var file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Export file', 'data-file': '1' }), islug = el('input', { 'aria-label': 'Import into', placeholder: 'import into this organization slug', maxlength: '60' });
      log = el('p', { class: 'msg', role: 'status' });
      var done = function (dry) { return function (t) { say((dry ? 'Check finished (nothing was written). ' : 'Import finished. ') + t.t + ' tickets ' + (dry ? 'would be added' : 'added') + ', ' + t.te + ' already there, ' + t.ts + ' skipped; ' + t.m + ' messages; ' + t.a + ' articles ' + (dry ? 'would be added' : 'added') + ', ' + t.ae + ' already there, ' + t.as + ' skipped; ' + t.f + ' files not copied.' + (t.w.length ? ' Notes: ' + t.w.slice(0, 5).join(' ') : '')); }; };
      var go = function (dry) { return function () { if (!islug.value.trim() || !file.files || !file.files[0]) return say('Choose the organization and the export file first.', true); runImport(islug.value.trim().toLowerCase(), file.files[0], dry).then(done(dry), function (e) { say(e.message, true); }); }; };
      var nav = el('nav', { class: 'admnav', 'aria-label': 'Admin sections' }, SECTIONS.map(function (g) { return el('div', { class: 'navgroup' }, el('div', { class: 'navhead' }, g[0]), g[1].map(function (x) { return el('a', { href: '#' + x[0], 'data-nav': x[0], onclick: function () { show(x[0]); } }, x[1]); })); }));
      var licence = el('div', {}, el('h2', {}, 'Lifetime licences'), el('div', { class: 'card' }, el('p', { class: 'm' }, 'Unlimited agents and every feature, for ever, without paying. Subscriptions and Paddle events never change it. Use the address (slug) of the organization.'), slug, ' ', note, ' ',
        el('button', { class: 'btn', type: 'button', 'data-grant': '1', onclick: function () { call('POST', '/api/license', { slug: slug.value.trim().toLowerCase(), note: note.value }).then(function (r) { say(r.ok ? 'Licence granted to ' + slug.value.trim() + '.' : r.body.error || 'That did not work.', !r.ok); }); } }, 'Grant'), ' ',
        el('button', { class: 'btn l', type: 'button', 'data-revoke': '1', onclick: function () { call('DELETE', '/api/license', { slug: slug.value.trim().toLowerCase() }).then(function (r) { say(r.ok ? 'Licence removed.' : r.body.error || 'That did not work.', !r.ok); }); } }, 'Remove')));
      var imp = el('div', {}, el('h2', {}, 'Import the old desk (mdv)'), el('div', { class: 'card' }, el('p', { class: 'm' }, 'Choose the file you downloaded from the mdv console (Settings → Export for EffDesk). “Check first” writes nothing. Importing again never duplicates anything.'), islug, ' ', file, ' ',
        el('button', { class: 'btn l', type: 'button', 'data-check': '1', onclick: go(true) }, 'Check first'), ' ', el('button', { class: 'btn', type: 'button', 'data-import': '1', onclick: go(false) }, 'Import')));
      var panel = function (id, child) { return el('section', { 'data-panel': id, hidden: 'hidden' }, child); };
      main.appendChild(el('h1', {}, 'Platform admin'));
      main.appendChild(el('div', { class: 'adm' }, nav, el('div', { class: 'admbody' }, panel('overview', overviewPanel()), panel('customers', customersCard()), panel('licence', licence), panel('import', imp), P ? Object.keys(P.panels).map(function (k) { return panel(k, P.panels[k].el); }) : null, log)));
      drawList(); syncTabs(); show(section);
    }
    if (root.addEventListener) root.addEventListener('hashchange', function () { show(fromHash()); });
    section = fromHash();
    return call('GET', '/api/me').then(function (r) { if (r.status === 401) return root.location.assign('/auth.html?mode=signin'); draw(); return call('GET', '/api/admin/customers').then(function (c) { people = c.ok ? c.body : { error: c.status === 403 ? 'You are signed in as ' + (r.body.user && r.body.user.email || 'this account') + ', which is not on the platform owner list. Add this email to PLATFORM_ADMIN_EMAILS in Netlify, redeploy, and reload.' : (c.body.error || 'The customer list could not be loaded.'), customers: [], totals: { organizations: 0, paying: 0, agents: 0, tickets30: 0, pastDue: 0, stalled: 0, heavy: 0 } }; draw(); }); });
  }
  root.EffDeskAdmin = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root));
})(typeof window !== 'undefined' ? window : this);
