// public/js/admin-panels.js: THE PLATFORM OWNER'S TOOLS in the admin console: errors, status page, logging, announcement and sign-up settings, people, activity, and one customer's limits and suspension. Every call goes to POST /api/admin/do. Draws text only.
(function (root) {
  'use strict';
  var STATES = [['operational', 'Operational'], ['degraded', 'Degraded performance'], ['partial_outage', 'Partial outage'], ['major_outage', 'Major outage'], ['maintenance', 'Under maintenance']];
  var STATE_NAME = {}; STATES.forEach(function (s) { STATE_NAME[s[0]] = s[1]; });
  var INC = [['investigating', 'Investigating'], ['identified', 'Identified'], ['monitoring', 'Monitoring'], ['resolved', 'Resolved']];
  var IMPACT = [['minor', 'Minor (degraded)'], ['major', 'Major (partial outage)'], ['critical', 'Critical (major outage)'], ['none', 'No impact']];

  function make(ctx) {
    var el = ctx.el, act = ctx.act, say = ctx.say, doc = ctx.doc;
    var when = function (v) { if (!v) return 'never'; var m = Math.round((Date.now() - new Date(v).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
    var opts = function (list, cur) { return list.map(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[0] === cur) op.selected = true; return op; }); };
    var field = function (label, input, hint) { return el('label', { class: 'fld' }, el('span', { class: 'fl' }, label), input, hint ? el('span', { class: 'm fh' }, hint) : null); };
    var clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; };
    var toast = function (r, ok) { say(r.ok ? ok : (r.body && r.body.error) || 'That did not work.', !r.ok); return r.ok; };
    var panels = {};

    // ---------- Errors
    (function () {
      var box = el('div', { 'data-errors': '1' }), list = el('div', { class: 'stack' }), state = 'open', open = {};
      function load() {
        return act('errors', { state: state }).then(function (r) {
          clear(list); if (!r.ok) return list.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Errors could not be loaded.'));
          var rows = r.body.errors, s = r.body.summary;
          list.appendChild(el('p', { class: 'm', 'data-error-summary': '1' }, s.open + ' open · ' + s.occurrences24 + ' occurrences in the last 24 hours'));
          if (!rows.length) return list.appendChild(el('div', { class: 'empty' }, state === 'open' ? 'No open errors. Everything that fails will show up here and be emailed to you.' : 'Nothing resolved yet.'));
          rows.forEach(function (e) {
            var det = el('div', { class: 'edetail', hidden: open[e.id] ? undefined : 'hidden' }, el('pre', {}, e.stack || '(no stack)'), el('p', { class: 'm' }, 'First seen ' + new Date(e.first_seen).toLocaleString() + (e.request_id ? ' · request id ' + e.request_id : '') + (e.deploy ? ' · deploy ' + e.deploy : '') + (e.org_id ? ' · workspace ' + e.org_id : '') + '. Search the logs for the request id.'));
            if (!open[e.id]) det.setAttribute('hidden', 'hidden'); else det.removeAttribute('hidden');
            list.appendChild(el('article', { class: 'erow', 'data-error': e.id },
              el('div', { class: 'ehead' },
                el('button', { type: 'button', class: 'linkbtn etitle', 'aria-expanded': open[e.id] ? 'true' : 'false', onclick: function () { open[e.id] = !open[e.id]; load(); } }, e.name + ': ' + e.message),
                el('span', { class: 'chip ' + (e.source === 'browser' ? 'info' : 'bad') }, e.source === 'browser' ? 'Browser' : 'Server'), el('span', { class: 'chip' }, '×' + e.count)),
              el('div', { class: 'm' }, (e.fn || '') + (e.path ? ' ' + e.path : '') + (e.status ? ' · answered ' + e.status : '') + ' · last seen ' + when(e.last_seen)),
              det,
              el('div', { class: 'row' },
                el('button', { type: 'button', class: 'btn l', 'data-error-resolve': e.id, onclick: function () { act('error-resolve', { id: e.id, resolved: !e.resolved_at }).then(function (x) { if (toast(x, e.resolved_at ? 'Reopened.' : 'Marked resolved.')) load(); }); } }, e.resolved_at ? 'Reopen' : 'Mark resolved'),
                el('button', { type: 'button', class: 'btn l danger', onclick: function () { act('error-delete', { id: e.id }).then(function (x) { if (toast(x, 'Deleted.')) load(); }); } }, 'Delete'))));
          });
        });
      }
      var tabs = el('div', { class: 'subtabs' }, [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(function (o) { return el('button', { type: 'button', class: 'subtab', 'aria-selected': o[0] === 'open' ? 'true' : 'false', 'data-errtab': o[0], onclick: function () { state = o[0]; [].slice.call(box.querySelectorAll('[data-errtab]')).forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-errtab') === state ? 'true' : 'false'); }); load(); } }, o[1]); }));
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'Errors'), el('button', { type: 'button', class: 'btn l', 'data-error-test': '1', onclick: function () { act('error-test', {}).then(function (x) { if (toast(x, x.body.alerted ? 'Test error recorded. An email is on its way to the platform owners.' : 'Test error recorded. No email was sent: check PLATFORM_ADMIN_EMAILS and RESEND_API_KEY.')) load(); }); } }, 'Send a test error')));
      box.appendChild(el('p', { class: 'm' }, 'Server crashes, 5xx answers, console errors and browser script errors, one line per kind with a count. New kinds, kinds that come back and kinds still happening an hour later are emailed to you.'));
      box.appendChild(tabs); box.appendChild(list);
      panels.errors = { el: box, load: load };
    })();

    // ---------- Status page
    (function () {
      var box = el('div', { 'data-status': '1' }), comps = el('div', { class: 'stack' }), incs = el('div', { class: 'stack' }), data = null, form = el('div');
      function loadAll() { return act('status-list', {}).then(function (r) { if (!r.ok) { clear(comps); return comps.appendChild(el('p', { class: 'msg err' }, r.body.error || 'The status page could not be loaded.')); } data = r.body; drawComps(); drawIncs(); drawForm(); }); }
      function drawComps() {
        clear(comps);
        data.components.forEach(function (c) {
          var name = el('input', { 'aria-label': 'Component name', value: c.name, maxlength: '80' }), desc = el('input', { 'aria-label': 'Description', value: c.description || '', maxlength: '200', placeholder: 'What it covers' }), st = el('select', { 'aria-label': 'Status' }, opts(STATES, c.status)), vis = el('input', { type: 'checkbox', 'aria-label': 'Show on the page' }); vis.checked = c.visible !== false;
          comps.appendChild(el('div', { class: 'crow', 'data-component': c.id }, name, desc, st, el('label', { class: 'chk' }, vis, ' Visible'),
            el('button', { type: 'button', class: 'btn l', onclick: function () { act('status-component-save', { id: c.id, name: name.value, description: desc.value, status: st.value, position: c.position, visible: vis.checked }).then(function (x) { if (toast(x, 'Saved ' + name.value + '.')) loadAll(); }); } }, 'Save'),
            c.auto_check ? el('span', { class: 'chip info', title: 'Checked live' }, 'Live check') : el('button', { type: 'button', class: 'btn l danger', onclick: function () { act('status-component-delete', { id: c.id }).then(function (x) { if (toast(x, 'Deleted.')) loadAll(); }); } }, 'Delete')));
        });
        var nn = el('input', { 'aria-label': 'New component name', placeholder: 'New component, for example Billing', maxlength: '80' }), nd = el('input', { 'aria-label': 'New component description', placeholder: 'What it covers', maxlength: '200' });
        comps.appendChild(el('div', { class: 'crow add' }, nn, nd, el('button', { type: 'button', class: 'btn', 'data-add-component': '1', onclick: function () { act('status-component-save', { name: nn.value, description: nd.value, status: 'operational' }).then(function (x) { if (toast(x, 'Component added.')) loadAll(); }); } }, 'Add component')));
      }
      function drawIncs() {
        clear(incs);
        if (!data.incidents.length) return incs.appendChild(el('div', { class: 'empty' }, 'Nothing posted yet. Post an incident when something breaks, or schedule maintenance ahead of time.'));
        data.incidents.forEach(function (i) {
          var live = i.status !== 'resolved' && i.status !== 'completed';
          incs.appendChild(el('article', { class: 'erow', 'data-incident': i.id },
            el('div', { class: 'ehead' }, el('strong', {}, i.title), el('span', { class: 'chip ' + (i.kind === 'maintenance' ? 'info' : live ? 'bad' : '') }, i.kind === 'maintenance' ? 'Maintenance' : i.impact), el('span', { class: 'chip' }, i.status)),
            el('div', { class: 'm' }, 'Started ' + new Date(i.started_at).toLocaleString() + (i.scheduled_for ? ' · window ' + new Date(i.scheduled_for).toLocaleString() + ' to ' + new Date(i.scheduled_until).toLocaleString() : '')),
            live ? updateForm(i) : null,
            el('div', { class: 'row' }, el('a', { class: 'btn l', href: '/status/incidents/' + i.id, target: '_blank', rel: 'noopener' }, 'View'), el('button', { type: 'button', class: 'btn l danger', onclick: function () { act('status-incident-delete', { id: i.id }).then(function (x) { if (toast(x, 'Deleted.')) loadAll(); }); } }, 'Delete'))));
        });
      }
      function updateForm(i) {
        var st = el('select', { 'aria-label': 'New status' }, opts(i.kind === 'maintenance' ? [['scheduled', 'Scheduled'], ['in_progress', 'In progress'], ['resolved', 'Completed']] : INC, i.status)), body = el('input', { 'aria-label': 'Update text', placeholder: 'Write an update people will understand', maxlength: '4000' });
        return el('div', { class: 'upd' }, st, body, el('button', { type: 'button', class: 'btn', 'data-post-update': i.id, onclick: function () { act('status-incident-update', { id: i.id, status: st.value, body: body.value }).then(function (x) { if (toast(x, st.value === 'resolved' ? 'Resolved. It moved to past incidents.' : 'Update posted.')) loadAll(); }); } }, 'Post update'));
      }
      function drawForm() {
        clear(form);
        var kind = el('select', { 'aria-label': 'Type' }, opts([['incident', 'Incident'], ['maintenance', 'Planned maintenance']], 'incident')), title = el('input', { 'aria-label': 'Incident title', maxlength: '140', placeholder: 'Slow ticket loading' }), impact = el('select', { 'aria-label': 'Impact' }, opts(IMPACT, 'minor')), status = el('select', { 'aria-label': 'First status' }, opts(INC.slice(0, 3), 'investigating')), body = el('textarea', { 'aria-label': 'First update', rows: '3', maxlength: '4000', placeholder: 'We are looking into reports of…' });
        var from = el('input', { type: 'datetime-local', 'aria-label': 'Starts' }), to = el('input', { type: 'datetime-local', 'aria-label': 'Ends' }), when2 = el('div', { class: 'grid2', hidden: 'hidden' }, field('Starts', from), field('Ends', to));
        var checks = data.components.map(function (c) { var cb = el('input', { type: 'checkbox', value: String(c.id), 'aria-label': c.name }); return el('label', { class: 'chk' }, cb, ' ' + c.name); });
        kind.addEventListener('change', function () { var m = kind.value === 'maintenance'; if (m) when2.removeAttribute('hidden'); else when2.setAttribute('hidden', 'hidden'); impact.disabled = status.disabled = m; });
        form.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Post to the status page'), el('div', { class: 'grid2' }, field('Type', kind), field('Title', title)), el('div', { class: 'grid2' }, field('Impact', impact), field('Status', status)), when2, field('First update', body), el('div', { class: 'fl' }, 'Affects'), el('div', { class: 'checks' }, checks),
          el('p', {}, el('button', { type: 'button', class: 'btn', 'data-post-incident': '1', onclick: function () {
            var ids = [].slice.call(form.querySelectorAll('.checks input')).filter(function (c) { return c.checked; }).map(function (c) { return Number(c.value); });
            var iso = function (v) { return v ? new Date(v).toISOString() : ''; };
            act('status-incident-create', { kind: kind.value, title: title.value, impact: impact.value, status: status.value, body: body.value, componentIds: ids, scheduledFor: iso(from.value), scheduledUntil: iso(to.value) }).then(function (x) { if (toast(x, 'Posted. It is on the status page now.')) loadAll(); });
          } }, 'Post'))));
      }
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'Status page'), el('a', { class: 'btn l', href: '/status', target: '_blank', rel: 'noopener', 'data-open-status': '1' }, 'Open public page')));
      box.appendChild(el('p', { class: 'm' }, 'What customers see at effdesk.com/status. The page shows the worst of: a component’s own status, open incidents, maintenance in progress and a live database check. It is only as accurate as what you post.'));
      box.appendChild(form); box.appendChild(el('h3', {}, 'Components')); box.appendChild(comps); box.appendChild(el('h3', {}, 'Incidents and maintenance')); box.appendChild(incs);
      panels.status = { el: box, load: loadAll };
    })();

    // ---------- Performance & health
    (function () {
      var box = el('div', { 'data-performance': '1' }), body = el('div', { class: 'stack' }), range = '24h';
      var metric = function (label, value, hint) { return el('div', { class: 'tile' }, el('div', { class: 'tv' }, String(value)), el('div', { class: 'tl' }, label), hint ? el('div', { class: 'm fh' }, hint) : null); };
      function load() {
        clear(body); body.appendChild(el('p', { class: 'm' }, 'Loading sampled performance data…'));
        return act('performance', { range: range }).then(function (r) {
          clear(body); if (!r.ok) return body.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Performance data could not be loaded.'));
          var d = r.body, s = d.summary, pct = s.error_rate + '%', rate = Math.round(d.sampleRate * 100) + '%';
          body.appendChild(el('div', { class: 'bar' }, el('button', { type: 'button', class: 'btn ' + (range === '1h' ? '' : 'l'), 'data-perf-range': '1h', onclick: function () { range = '1h'; load(); } }, 'Last hour'), el('button', { type: 'button', class: 'btn ' + (range === '24h' ? '' : 'l'), 'data-perf-range': '24h', onclick: function () { range = '24h'; load(); } }, 'Last 24 hours'), el('button', { type: 'button', class: 'btn l', 'data-perf-refresh': '1', onclick: load }, 'Refresh')));
          body.appendChild(el('p', { class: 'm' }, 'Sampled server requests · ' + rate + ' sampling · SQL sampling ' + Math.round((d.sqlSampleRate || 0) * 100) + '% · 14-day rolling retention. Measurements begin after this release is deployed.'));
          body.appendChild(el('div', { class: 'tiles perf-tiles' }, metric('Sampled requests', s.requests.toLocaleString()), metric('Average latency', s.avg_ms + ' ms'), metric('p95 latency band', s.p95_bucket || '—', 'Approximate histogram band'), metric('HTTP 5xx rate', pct), metric('Slow requests ≥1s', s.slow_requests.toLocaleString()), metric('Max pool waiters', s.pool_waiting_max, 'Observed at request completion')));
          body.appendChild(el('h3', {}, 'Automated findings'));
          var diag = el('div', { class: 'stack' });
          d.diagnostics.forEach(function (x) { diag.appendChild(el('article', { class: 'erow perf-finding ' + x.severity }, el('div', { class: 'ehead' }, el('strong', {}, x.title), el('span', { class: 'chip ' + (x.severity === 'critical' ? 'bad' : x.severity === 'success' ? 'info' : '') }, x.severity)), el('p', { class: 'm' }, x.detail))); });
          body.appendChild(diag);
          body.appendChild(el('h3', {}, 'Hourly trend · selected period'));
          if (!d.series.length) body.appendChild(el('p', { class: 'm' }, 'Hourly trends will appear as requests are sampled.'));
          else body.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'adtable perf-table' }, el('thead', {}, el('tr', {}, ['Hour (UTC)', 'Samples', 'Avg latency', '5xx errors'].map(function (x) { return el('th', { scope: 'col' }, x); }))), el('tbody', {}, d.series.map(function (x) { return el('tr', {}, el('td', {}, new Date(x.hour).toLocaleString()), el('td', {}, x.requests.toLocaleString()), el('td', {}, x.avg_ms + ' ms'), el('td', {}, x.errors)); })))));
          body.appendChild(el('h3', {}, 'Slowest endpoints · last 24 hours'));
          if (!d.routes.length) body.appendChild(el('div', { class: 'empty' }, 'No endpoint samples yet.'));
          else body.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'adtable perf-table' }, el('thead', {}, el('tr', {}, ['Function', 'Endpoint', 'Samples', 'Avg', 'p95 band', 'Max'].map(function (x) { return el('th', { scope: 'col' }, x); }))), el('tbody', {}, d.routes.map(function (x) { return el('tr', {}, el('td', {}, x.function_name), el('td', {}, x.path), el('td', {}, x.requests.toLocaleString()), el('td', {}, x.avg_ms + ' ms'), el('td', {}, x.p95_bucket), el('td', {}, x.max_ms + ' ms')); })))));
          body.appendChild(el('h3', {}, 'Tenant performance · last 24 hours'));
          if (!d.tenants.length) body.appendChild(el('p', { class: 'm' }, 'Tenant comparisons will appear as sampled requests arrive with workspace context.'));
          else body.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'adtable perf-table' }, el('thead', {}, el('tr', {}, ['Workspace ID', 'Samples', 'Avg latency', 'Errors', 'Max latency'].map(function (x) { return el('th', { scope: 'col' }, x); }))), el('tbody', {}, d.tenants.map(function (x) { return el('tr', {}, el('td', {}, x.org_id), el('td', {}, x.requests.toLocaleString()), el('td', {}, x.avg_ms + ' ms'), el('td', {}, x.errors), el('td', {}, x.max_ms + ' ms')); })))));
          body.appendChild(el('h3', {}, 'Slowest SQL fingerprints · last 24 hours'));
          body.appendChild(el('p', { class: 'm' }, 'Sampled SQL operations are represented by a one-way fingerprint; raw SQL and parameter values are never stored.'));
          if (!d.sqlQueries || !d.sqlQueries.length) body.appendChild(el('p', { class: 'm' }, 'SQL query samples will appear after instrumented database traffic arrives.'));
          else body.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'adtable perf-table' }, el('thead', {}, el('tr', {}, ['Fingerprint', 'Operation', 'Function', 'Samples', 'Avg', 'p95 band', 'Max', 'Errors'].map(function (x) { return el('th', { scope: 'col' }, x); }))), el('tbody', {}, d.sqlQueries.map(function (x) { return el('tr', {}, el('td', {}, x.query_hash), el('td', {}, x.operation), el('td', {}, x.function_name), el('td', {}, x.samples.toLocaleString()), el('td', {}, x.avg_ms + ' ms'), el('td', {}, x.p95_bucket), el('td', {}, x.max_ms + ' ms'), el('td', {}, x.errors)); })))));
          body.appendChild(el('h3', {}, 'Real-user experience · Core Web Vitals & navigation'));
          body.appendChild(el('p', { class: 'm' }, 'Sampled agent-desk page views, grouped by metric, page and device. Ratings use Google’s published good / needs improvement / poor thresholds.'));
          if (!d.vitals || !d.vitals.length) body.appendChild(el('p', { class: 'm' }, 'Browser measurements will appear as agents use the desk after this release is deployed.'));
          else body.appendChild(el('div', { class: 'tablewrap' }, el('table', { class: 'adtable perf-table' }, el('thead', {}, el('tr', {}, ['Metric', 'Page', 'Device', 'Samples', 'Average', 'p75 rating', 'Good', 'Needs work', 'Poor'].map(function (x) { return el('th', { scope: 'col' }, x); }))), el('tbody', {}, d.vitals.map(function (x) { var unit = x.metric === 'CLS' ? '' : ' ms'; return el('tr', {}, el('td', {}, x.metric), el('td', {}, x.page), el('td', {}, x.device), el('td', {}, x.samples.toLocaleString()), el('td', {}, x.avg_value + unit), el('td', {}, x.p75_rating), el('td', {}, x.good_count), el('td', {}, x.needs_improvement_count), el('td', {}, x.poor_count)); })))));
          body.appendChild(el('h3', {}, 'Coverage and limitations'));
          body.appendChild(el('ul', { class: 't' }, d.notes.map(function (x) { return el('li', {}, x); })));
          body.appendChild(el('p', { class: 'm' }, 'Observed request volume: ' + s.requests.toLocaleString() + ' samples over ' + d.range + '. This is sampled telemetry, not a full request census.'));
        });
      }
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'Performance & health')));
      box.appendChild(el('p', { class: 'm' }, 'Spot slow endpoints, elevated server errors and database connection-pool contention across the EffDesk platform.'));
      box.appendChild(body); panels.performance = { el: box, load: load };
    })();

    // ---------- Logging
    (function () {
      var box = el('div', { 'data-logging': '1' }), body = el('div', { class: 'stack' });
      function row(label, on, detail) { return el('div', { class: 'srow' }, el('span', { class: 'dot ' + (on ? 'ok' : 'off') }), el('div', {}, el('strong', {}, label), el('div', { class: 'm' }, detail))); }
      function load() {
        return act('logging', {}).then(function (r) {
          clear(body); if (!r.ok) return body.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Could not load.'));
          var l = r.body.logging, out = el('div', { class: 'm', role: 'status', 'data-logging-result': '1' });
          body.appendChild(row('Axiom', l.axiom.configured, l.axiom.configured ? 'Sending to dataset “' + l.axiom.dataset + '” on ' + l.axiom.domain : 'Not set up. In Netlify set AXIOM_TOKEN and AXIOM_DATASET (and AXIOM_DOMAIN if your Axiom is in the EU), then redeploy.'));
          body.appendChild(row('Other log drain', l.drain.configured, l.drain.configured ? 'LOG_DRAIN_URL is set.' : 'Optional: LOG_DRAIN_URL and LOG_DRAIN_TOKEN send the same lines anywhere else.'));
          body.appendChild(row('Function logs', true, 'Every function writes one line per request (event, status, milliseconds, request id) to the Netlify function log as well.'));
          body.appendChild(row('Error tracking', true, 'Failures become a line on the Errors page and an email.'));
          body.appendChild(el('p', {}, el('button', { type: 'button', class: 'btn', 'data-logging-test': '1', onclick: function () { act('logging-test', {}).then(function (x) { clear(out); if (!x.ok) return out.appendChild(doc.createTextNode(x.body.error || 'Failed.')); if (!x.body.configured) return out.appendChild(doc.createTextNode('Nothing is configured to receive logs yet.')); out.appendChild(doc.createTextNode(x.body.results.map(function (s) { return s.sink + ': ' + (s.ok ? 'accepted (' + (s.status || 'ok') + ')' : 'refused' + (s.status ? ' (' + s.status + ')' : '') + (s.error ? ' ' + s.error : '')); }).join(' · ') + '. Look for event “logging_test” in the dataset.')); }); } }, 'Send a test log line'), ' ', el('span', { class: 'm' }, 'Writes one line named logging_test, and shows what Axiom answered.'))); body.appendChild(out);
        });
      }
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'Logging'))); box.appendChild(body); panels.logging = { el: box, load: load };
    })();

    // ---------- Settings
    (function () {
      var box = el('div', { 'data-settings': '1' }), body = el('div', { class: 'stack' });
      function load() {
        return act('settings-get', {}).then(function (r) {
          clear(body); if (!r.ok) return body.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Could not load.'));
          var a = r.body.settings.announcement, s = r.body.settings.signups;
          var on = el('input', { type: 'checkbox', 'aria-label': 'Show the announcement' }); on.checked = !!a.active;
          var text = el('input', { 'aria-label': 'Announcement text', value: a.text, maxlength: '280', placeholder: 'Maintenance tonight at 10pm UTC' }), tone = el('select', { 'aria-label': 'Tone' }, opts([['info', 'Information'], ['warn', 'Warning'], ['danger', 'Problem']], a.tone)), link = el('input', { 'aria-label': 'Announcement link', value: a.link, maxlength: '300', placeholder: 'https://effdesk.com/status (optional)' });
          body.appendChild(el('div', { class: 'card' }, el('h3', {}, 'Announcement banner'), el('p', { class: 'm' }, 'Shows at the top of every desk until you switch it off.'), el('label', { class: 'chk' }, on, ' Show it'), field('Text', text), el('div', { class: 'grid2' }, field('Tone', tone), field('Link', link)),
            el('p', {}, el('button', { type: 'button', class: 'btn', 'data-save-announcement': '1', onclick: function () { act('settings-save', { announcement: { active: on.checked, text: text.value, tone: tone.value, link: link.value } }).then(function (x) { toast(x, on.checked ? 'The banner is live in every desk.' : 'The banner is off.'); }); } }, 'Save'))));
          var open = el('input', { type: 'checkbox', 'aria-label': 'Allow new workspaces' }); open.checked = s.open !== false; var msg = el('input', { 'aria-label': 'Message when paused', value: s.message, maxlength: '200', placeholder: 'We are not taking new workspaces right now.' });
          body.appendChild(el('div', { class: 'card' }, el('h3', {}, 'New workspaces'), el('p', { class: 'm' }, 'Pause sign-ups during an incident or a migration. People who already have a workspace are not affected.'), el('label', { class: 'chk' }, open, ' Allow new sign-ups'), field('Message shown when paused', msg),
            el('p', {}, el('button', { type: 'button', class: 'btn', 'data-save-signups': '1', onclick: function () { act('settings-save', { signups: { open: open.checked, message: msg.value } }).then(function (x) { toast(x, open.checked ? 'Sign-ups are open.' : 'Sign-ups are paused.'); }); } }, 'Save'))));
        });
      }
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'Settings'))); box.appendChild(body); panels.settings = { el: box, load: load };
    })();

    // ---------- People
    (function () {
      var box = el('div', { 'data-users': '1' }), out = el('div', { class: 'stack' }), q = el('input', { 'aria-label': 'Search people', placeholder: 'Name or email', minlength: '2' });
      function go() {
        act('user-search', { q: q.value }).then(function (r) {
          clear(out); if (!r.ok) return out.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Search failed.'));
          if (!r.body.users.length) return out.appendChild(el('div', { class: 'empty' }, 'No one matches that.'));
          r.body.users.forEach(function (u) {
            out.appendChild(el('article', { class: 'erow', 'data-user': u.id }, el('div', { class: 'ehead' }, el('strong', {}, u.name || u.email), el('span', { class: 'm' }, u.email), el('span', { class: 'chip ' + (u.verified ? '' : 'bad') }, u.verified ? 'Verified' : 'Not verified')),
              el('div', { class: 'm' }, 'Joined ' + new Date(u.created_at).toLocaleDateString() + ' · last active ' + when(u.last_active) + ' · ' + u.sessions + ' active session' + (u.sessions === 1 ? '' : 's')),
              el('div', { class: 'm' }, u.orgs.length ? u.orgs.map(function (o) { return o.name + ' (' + o.role + ')'; }).join(', ') : 'No workspaces'),
              el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn l', 'data-signout': u.id, onclick: function () { act('user-signout', { userId: u.id }).then(function (x) { if (toast(x, 'Signed out of ' + x.body.signedOut + ' session' + (x.body.signedOut === 1 ? '' : 's') + '.')) go(); }); } }, 'Sign out everywhere'), u.verified ? null : el('button', { type: 'button', class: 'btn l', onclick: function () { act('user-verify', { userId: u.id }).then(function (x) { if (toast(x, 'Marked as verified.')) go(); }); } }, 'Mark email verified'))));
          });
        });
      }
      q.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'People'))); box.appendChild(el('p', { class: 'm' }, 'Find someone who cannot get in: see their workspaces, sign them out everywhere, or mark their email verified when the mail never arrived.'));
      box.appendChild(el('div', { class: 'bar' }, q, ' ', el('button', { type: 'button', class: 'btn', 'data-user-search': '1', onclick: go }, 'Search'))); box.appendChild(out); panels.users = { el: box, load: function () { return Promise.resolve(); } };
    })();

    // ---------- Activity
    (function () {
      var box = el('div', { 'data-activity': '1' }), out = el('div', { class: 'tablewrap' });
      function load() {
        return act('audit-list', { limit: 150 }).then(function (r) {
          clear(out); if (!r.ok) return out.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Could not load.'));
          if (!r.body.entries.length) return out.appendChild(el('div', { class: 'empty' }, 'Nothing yet. Every change made in this console is recorded here.'));
          out.appendChild(el('table', { class: 'adtable' }, el('thead', {}, el('tr', {}, ['When', 'Who', 'What', 'On'].map(function (h) { return el('th', { scope: 'col' }, h); }))), el('tbody', {}, r.body.entries.map(function (e) { return el('tr', {}, el('td', {}, new Date(e.at).toLocaleString()), el('td', {}, e.actor), el('td', {}, e.action), el('td', {}, e.target || '')); }))));
        });
      }
      box.appendChild(el('div', { class: 'phead' }, el('h2', {}, 'Activity'))); box.appendChild(el('p', { class: 'm' }, 'What owners changed in this console.')); box.appendChild(out); panels.activity = { el: box, load: load };
    })();

    // ---------- Overview health strip
    function health() {
      var strip = el('div', { class: 'health', 'data-health': '1' });
      act('system', {}).then(function (r) {
        if (!r.ok) return; var s = r.body, tone = { operational: 'ok', degraded: 'warn', maintenance: 'warn' }[s.status] || 'bad';
        var item = function (label, value, tone2, href) { return el('a', { class: 'hitem', href: href }, el('span', { class: 'dot ' + tone2 }), el('span', {}, el('strong', {}, value), el('span', { class: 'm' }, ' ' + label))); };
        strip.appendChild(item('status page', STATE_NAME[s.status] || s.status, tone, '#status')); strip.appendChild(item('open errors', String(s.openErrors), s.openErrors ? 'bad' : 'ok', '#errors')); strip.appendChild(item('logging', s.logging.axiom.configured ? 'Axiom connected' : 'Axiom not set up', s.logging.axiom.configured ? 'ok' : 'warn', '#logging'));
        if (s.openIncidents) strip.appendChild(item('open incidents', String(s.openIncidents), 'bad', '#status'));
      });
      return strip;
    }

    // ---------- one customer: limits, features, suspension
    function customerControls(slug) {
      var box = el('div', { class: 'card', 'data-controls': slug }, el('p', { class: 'm' }, 'Loading plan and limits…'));
      act('customer-get', { slug: slug }).then(function (r) {
        clear(box); if (!r.ok) return box.appendChild(el('p', { class: 'msg err' }, r.body.error || 'Could not load settings.'));
        var d = r.body, o = d.overrides, e = d.effective;
        var num = function (label, v, hint) { return field(label, el('input', { inputmode: 'numeric', 'aria-label': label, value: v == null ? '' : String(v), placeholder: 'Plan default' }), hint); };
        var seat = num('Seat limit', o.seat_limit), mail = num('Emails per day', o.mail_per_day), mb = num('Storage (MB)', o.storage_mb), ai = num('AI replies per month', o.ai_monthly), note = el('textarea', { rows: '2', 'aria-label': 'Internal note', maxlength: '2000', placeholder: 'Only visible to you' }, o.note || '');
        var sel = {}, feats = d.allFeatures.map(function (f) { var cur = (o.features_on || []).indexOf(f) >= 0 ? 'on' : (o.features_off || []).indexOf(f) >= 0 ? 'off' : 'plan', s = el('select', { 'aria-label': f }, opts([['plan', 'Plan default (' + (e.features.indexOf(f) >= 0 || cur === 'off' ? 'on' : 'off') + ')'], ['on', 'Always on'], ['off', 'Off']], cur)); sel[f] = s; return el('label', { class: 'fld feat' }, el('span', { class: 'fl' }, f.replace(/_/g, ' ')), s); });
        box.appendChild(el('h3', {}, 'Plan, limits and features')); box.appendChild(el('p', { class: 'm' }, 'Effective plan: ' + e.plan + (e.license ? ' (lifetime licence)' : '') + '. Leave a limit empty to use the plan’s.'));
        box.appendChild(el('div', { class: 'grid4' }, seat, mail, mb, ai)); box.appendChild(el('div', { class: 'grid4 feats' }, feats)); box.appendChild(field('Note', note));
        box.appendChild(el('p', {}, el('button', { type: 'button', class: 'btn', 'data-save-overrides': '1', onclick: function () {
          var on = [], off = []; Object.keys(sel).forEach(function (f) { if (sel[f].value === 'on') on.push(f); if (sel[f].value === 'off') off.push(f); });
          act('customer-save', { slug: slug, seatLimit: seat.querySelector('input').value, mailPerDay: mail.querySelector('input').value, storageMb: mb.querySelector('input').value, aiMonthly: ai.querySelector('input').value, featuresOn: on, featuresOff: off, note: note.value }).then(function (x) { toast(x, 'Saved. It applies on the customer’s next request.'); });
        } }, 'Save changes')));
        var why = el('input', { 'aria-label': 'Reason for suspending', placeholder: 'Reason the customer will see', maxlength: '200', value: o.suspended_reason || '' });
        box.appendChild(el('h3', { style: 'margin-top:20px' }, o.suspended ? 'This workspace is suspended' : 'Suspend this workspace'));
        box.appendChild(el('p', { class: 'm' }, 'Agents see the reason and cannot work until you restore it. Your support view still works.'));
        box.appendChild(el('div', { class: 'bar' }, o.suspended ? null : why, ' ', el('button', { type: 'button', class: 'btn ' + (o.suspended ? '' : 'danger'), 'data-suspend': '1', onclick: function () { act('customer-suspend', { slug: slug, suspended: !o.suspended, reason: why.value }).then(function (x) { if (toast(x, o.suspended ? 'Restored.' : 'Suspended.')) { var n = customerControls(slug); box.replaceWith(n); } }); } }, o.suspended ? 'Restore access' : 'Suspend')));
      });
      return box;
    }

    return { panels: panels, health: health, customerControls: customerControls };
  }
  root.EffDeskAdminPanels = { make: make };
})(typeof window !== 'undefined' ? window : this);
