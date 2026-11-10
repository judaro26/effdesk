// public/js/admin.js: THE PLATFORM OWNER'S PAGE: give or take back a lifetime licence, and import the old desk's data (the export file of the mdv console) in batches. The server refuses anyone who is not the platform owner. Draws text only.
(function (root) {
  'use strict';
  var BATCH = 100;
  function start(doc, fetchFn) {
    var main = doc.getElementById('main'), log = null, people = null, filt = 'all', q = '';
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]); }); [].concat.apply([], [].slice.call(arguments, 2)).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
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
    function customersCard() {
      var box = el('div', { class: 'card', style: 'margin:16px 0', 'data-customers': '1' }, el('h3', {}, 'Customers'));
      if (!people) { box.appendChild(el('p', { class: 'm' }, 'Loading…')); return box; }
      var t = people.totals;
      box.appendChild(el('p', { class: 'm', 'data-totals': '1' }, t.organizations + ' organizations · ' + t.paying + ' paying · ' + t.agents + ' agents · ' + t.tickets30 + ' tickets in the last 30 days · ' + t.pastDue + ' past due · ' + t.stalled + ' stalled · ' + t.heavy + ' heavy'));
      var fs = el('select', { 'aria-label': 'Show' }, [['all', 'All'], ['paying', 'Paying'], ['free', 'Free'], ['past_due', 'Past due'], ['stalled', 'Stalled'], ['heavy', 'Heavy use'], ['canceled', 'Canceled']].map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === filt) op.setAttribute('selected', ''); return op; }));
      fs.addEventListener('change', function () { filt = fs.value; drawList(); });
      var qb = el('input', { 'aria-label': 'Search customers', placeholder: 'Search name, address or owner', value: q }); qb.addEventListener('input', function () { q = qb.value; drawList(); });
      box.appendChild(el('div', { class: 'bar' }, fs, ' ', qb, ' ', el('a', { class: 'btn l', href: '/api/admin/customers?format=csv', 'data-customers-csv': '1' }, 'Download CSV')));
      box.appendChild(el('div', { id: 'custlist', style: 'overflow:auto' })); return box;
    }
    function drawList() {
      var host = doc.getElementById('custlist'); if (!host || !people) return; while (host.firstChild) host.removeChild(host.firstChild);
      var rows = people.customers.filter(function (c) { var h = c.health; return (filt === 'all' || (filt === 'paying' ? c.plan !== 'free' && c.status !== 'canceled' && c.status !== 'none' : filt === 'free' ? c.plan === 'free' : h === filt)) && (!q || (c.name + ' ' + c.slug + ' ' + (c.owner || '')).toLowerCase().indexOf(q.toLowerCase()) >= 0); });
      var th = function (x) { return el('th', { style: 'text-align:left;padding:6px 8px' }, x); }, td = function (x) { return el('td', { style: 'padding:6px 8px;border-top:1px solid #e6e1d6' }, x); };
      var tb = el('table', { style: 'width:100%;border-collapse:collapse;font-size:14px' }, el('thead', {}, el('tr', {}, ['Customer', 'Owner', 'Plan', 'Agents', 'Tickets 30d', 'Total', 'Last active', 'Health'].map(th))),
        el('tbody', {}, rows.map(function (c) { return el('tr', { 'data-org': c.slug }, td(el('span', {}, el('strong', {}, c.name), ' ', el('span', { class: 'm' }, c.slug))), td(c.owner || ''), td(c.plan + (c.status && c.status !== 'none' && c.status !== 'licence' ? ' (' + c.status + ')' : '') + (c.seatsPaid ? ' · ' + c.seatsPaid + ' seats' : '')), td(String(c.agents) + (c.invites ? ' (+' + c.invites + ' invited)' : '')), td(String(c.tickets.last30)), td(String(c.tickets.total)), td(ago(c.lastActive)), td(HEALTH[c.health] || c.health)); })));
      host.appendChild(rows.length ? tb : el('p', { class: 'm' }, 'No customers match.'));
    }
    function draw() {
      while (main.firstChild) main.removeChild(main.firstChild);
      var slug = el('input', { 'aria-label': 'Organization slug', placeholder: 'organization slug, for example mdv', maxlength: '60' }), note = el('input', { 'aria-label': 'Note', placeholder: 'note (for example: mdv, our own company)', maxlength: '200' });
      var file = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Export file', 'data-file': '1' }), islug = el('input', { 'aria-label': 'Import into', placeholder: 'import into this organization slug', maxlength: '60' });
      log = el('p', { class: 'msg', role: 'status' });
      var done = function (dry) { return function (t) { say((dry ? 'Check finished (nothing was written). ' : 'Import finished. ') + t.t + ' tickets ' + (dry ? 'would be added' : 'added') + ', ' + t.te + ' already there, ' + t.ts + ' skipped; ' + t.m + ' messages; ' + t.a + ' articles ' + (dry ? 'would be added' : 'added') + ', ' + t.ae + ' already there, ' + t.as + ' skipped; ' + t.f + ' files not copied.' + (t.w.length ? ' Notes: ' + t.w.slice(0, 5).join(' ') : '')); }; };
      var go = function (dry) { return function () { if (!islug.value.trim() || !file.files || !file.files[0]) return say('Choose the organization and the export file first.', true); runImport(islug.value.trim().toLowerCase(), file.files[0], dry).then(done(dry), function (e) { say(e.message, true); }); }; };
      main.appendChild(el('h1', {}, 'Platform admin'));
      main.appendChild(customersCard()); drawList();
      main.appendChild(el('div', { class: 'card', style: 'margin:16px 0' }, el('h3', {}, 'Lifetime licence'), el('p', { class: 'm' }, 'Unlimited agents and every feature, for ever, without paying. Subscriptions and Paddle events never change it.'), slug, ' ', note, ' ',
        el('button', { class: 'btn', type: 'button', 'data-grant': '1', onclick: function () { call('POST', '/api/license', { slug: slug.value.trim().toLowerCase(), note: note.value }).then(function (r) { say(r.ok ? 'Licence granted to ' + slug.value.trim() + '.' : r.body.error || 'That did not work.', !r.ok); }); } }, 'Grant'), ' ',
        el('button', { class: 'btn l', type: 'button', 'data-revoke': '1', onclick: function () { call('DELETE', '/api/license', { slug: slug.value.trim().toLowerCase() }).then(function (r) { say(r.ok ? 'Licence removed.' : r.body.error || 'That did not work.', !r.ok); }); } }, 'Remove')));
      main.appendChild(el('div', { class: 'card', style: 'margin:16px 0' }, el('h3', {}, 'Import the old desk (mdv)'), el('p', { class: 'm' }, 'Choose the file you downloaded from the mdv console (Settings → Export for EffDesk). “Check first” writes nothing. Importing again never duplicates anything.'), islug, ' ', file, ' ',
        el('button', { class: 'btn l', type: 'button', 'data-check': '1', onclick: go(true) }, 'Check first'), ' ', el('button', { class: 'btn', type: 'button', 'data-import': '1', onclick: go(false) }, 'Import')));
      main.appendChild(log);
    }
    return call('GET', '/api/me').then(function (r) { if (r.status === 401) return root.location.assign('/auth.html?mode=signin'); draw(); return call('GET', '/api/admin/customers').then(function (c) { people = c.ok ? c.body : { customers: [], totals: { organizations: 0, paying: 0, agents: 0, tickets30: 0, pastDue: 0, stalled: 0, heavy: 0 } }; draw(); }); });
  }
  root.EffDeskAdmin = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root));
})(typeof window !== 'undefined' ? window : this);
