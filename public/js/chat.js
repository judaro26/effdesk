// public/js/chat.js: THE CHAT WINDOW (inside the widget's frame): a short form to start, then the conversation. It asks for new messages every few seconds while it is open.
(function (root) {
  'use strict';
  var doc = root.document, q = new URLSearchParams(root.location.search), org = q.get('org') || '', PAGE_URL = q.get('page') || doc.referrer || '', KEY = 'effdesk_chat_' + org, VISITOR_KEY = KEY + '_visitor';
  var main = doc.getElementById('main'), state = { number: 0, token: '', last: 0, ended: false }, timer = null, seen = {};
  var el = function (tag, attrs) { var e = doc.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }); [].slice.call(arguments, 2).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
  var store = { get: function () { try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }, set: function (v) { try { if (v) root.localStorage.setItem(KEY, JSON.stringify(v)); else root.localStorage.removeItem(KEY); } catch (e) { } } };
  function visitorId() {
    try {
      var saved = root.localStorage.getItem(VISITOR_KEY);
      if (/^[a-f0-9]{64}$/i.test(saved || '')) return saved;
      if (!root.crypto || !root.crypto.getRandomValues) return '';
      var bytes = new Uint8Array(32); root.crypto.getRandomValues(bytes);
      var id = Array.prototype.map.call(bytes, function (v) { return v.toString(16).padStart(2, '0'); }).join('');
      root.localStorage.setItem(VISITOR_KEY, id); return id;
    } catch (e) { return ''; }
  }
  var reported = {}, safeDiagnostic = function (value, max) { return String(value || '').replace(/https?:\/\/[^\s)]+/g, '[url]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').replace(/\b[a-f0-9]{32,}\b/gi, '[redacted]').slice(0, max); }, reportFailure = function (name, message, stack, page) {
    var key = String(name || 'Error') + '|' + String(message || '').slice(0, 180);
    if (reported[key] || !message) return; reported[key] = 1;
    try { root.fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: String(name || 'ChatError').slice(0, 80), message: safeDiagnostic(message, 300), stack: safeDiagnostic(stack, 1200), page: String(page || root.location.pathname).split('?')[0].slice(0, 200) }), keepalive: true }).catch(function () {}); } catch (e) {}
  };
  root.addEventListener('error', function (e) { reportFailure(e.error && e.error.name || 'BrowserError', e.message || 'Chat widget script error', e.error && e.error.stack, root.location.pathname); });
  root.addEventListener('unhandledrejection', function (e) { var reason = e.reason || {}; reportFailure(reason.name || 'UnhandledRejection', reason.message || String(reason), reason.stack, root.location.pathname); });
  var api = function (path, body) {
    var endpoint = '/api/chat/' + path, operation = String(path).split('?')[0];
    return root.fetch(endpoint, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, body)) } : undefined).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status >= 500) reportFailure('ChatHttp' + r.status, 'Live Chat ' + operation + ' returned HTTP ' + r.status, '', endpoint);
        return { ok: r.ok, status: r.status, requestId: r.headers && r.headers.get('x-request-id'), body: j };
      });
    }).catch(function (e) {
      reportFailure(e && e.name || 'NetworkError', 'Live Chat ' + operation + ' request failed: ' + String(e && e.message || e), e && e.stack, endpoint);
      throw e;
    });
  };
  var clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); };
  var cfg = null;
  function start() {
    clear(main); stop();
    var name = el('input', { 'aria-label': 'Your name', placeholder: 'Your name', maxlength: '100', autocomplete: 'name' }), email = el('input', { 'aria-label': 'Your email', placeholder: 'you@example.com', type: 'email', maxlength: '254', autocomplete: 'email' });
    var msg = el('textarea', { 'aria-label': 'Your message', placeholder: 'How can we help?', maxlength: '2000', rows: '3' }), err = el('div', { class: 'err', role: 'alert' }), go = el('button', { type: 'submit', text: cfg.accepting ? 'Start chat' : 'Send message' });
    var form = el('form', {}, el('div', { class: 'note' + (cfg.accepting ? '' : ' offline'), text: cfg.accepting ? cfg.greeting : 'We’re not accepting live chats right now. Leave a message and we’ll reply here, or by email if you leave.' }), name, email, msg, err, go);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = ''; go.disabled = true;
      api('start?org=' + encodeURIComponent(org), { name: name.value, email: email.value, message: msg.value, visitorId: visitorId(), pageUrl: PAGE_URL }).then(function (r) {
        go.disabled = false; if (!r.ok) { err.textContent = (r.body.error || 'The chat could not start.') + (r.requestId ? ' Reference: ' + r.requestId : ''); return; }
        state = { number: r.body.number, token: r.body.token, last: 0, ended: false }; seen = {}; store.set({ number: state.number, token: state.token }); conversation();
      }).catch(function () { go.disabled = false; err.textContent = 'No connection. Your message was not sent. Please try again.'; });
    });
    main.appendChild(form); name.focus();
  }
  function bubble(m) {
    if (seen[m.id]) return null; seen[m.id] = 1;
    var b = el('div', { class: 'b ' + m.from, 'data-id': String(m.id) });
    if (m.from === 'agent') b.appendChild(el('div', { class: 'who', text: m.name || 'Support team' }));
    if (root.EffFormat) root.EffFormat.toDom(doc, m.body, b); else b.appendChild(el('p', { text: m.body }));
    if (m.at) { var d = new Date(m.at); if (!isNaN(d.getTime())) { var today = new Date(), sameDay = d.toDateString() === today.toDateString(), stamp = sameDay ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); b.appendChild(el('time', { class: 'b-time', datetime: d.toISOString(), title: d.toLocaleString() }, stamp)); } }
    return b;
  }
  function conversation() {
    clear(main);
    var assignment = el('div', { class: 'chat-assignment', id: 'chat-assignment', role: 'status', 'aria-live': 'polite' }, 'Waiting for an agent to join…'), log = el('div', { class: 'log', id: 'log', role: 'log' }), typing = el('div', { class: 'chat-typing', id: 'chat-typing', role: 'status', 'aria-live': 'polite', hidden: 'hidden' }, el('span', { class: 'chat-typing-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')), el('span', { class: 'chat-typing-label' }, 'An agent is typing…')), note = el('div', { class: 'note', id: 'ended', hidden: 'hidden' });
    var ta = el('textarea', { 'aria-label': 'Message', placeholder: 'Write a message', rows: '1', maxlength: '2000' }), send = el('button', { type: 'submit', text: 'Send' }), form = el('form', { class: 'send' }, ta, send);
    var again = el('button', { type: 'button', class: 'link', text: 'Start a new chat' }); again.addEventListener('click', function () { store.set(null); state = { number: 0, token: '', last: 0, ended: false }; start(); });
    var controls = el('div', { class: 'chat-actions' });
    var transcript = el('button', { type: 'button', class: 'chat-action-link', text: 'Email me a transcript' });
    transcript.addEventListener('click', function () {
      transcript.disabled = true;
      api('transcript?org=' + encodeURIComponent(org), { number: state.number, token: state.token }).then(function (r) {
        var notice = doc.getElementById('chat-action-notice');
        if (notice) notice.textContent = r.ok ? 'Transcript sent to the email address you provided.' : (r.body.error || 'The transcript could not be sent.');
      }).catch(function () { var notice = doc.getElementById('chat-action-notice'); if (notice) notice.textContent = 'Connection interrupted. Please try again.'; }).then(function () { transcript.disabled = false; });
    });
    var end = el('button', { type: 'button', class: 'chat-action-link danger', text: 'End chat' });
    end.addEventListener('click', function () {
      if (typeof root.confirm === 'function' && !root.confirm('End this conversation? You will no longer be able to send messages in it.')) return;
      end.disabled = true;
      api('end?org=' + encodeURIComponent(org), { number: state.number, token: state.token }).then(function (r) {
        if (!r.ok) { end.disabled = false; var notice = doc.getElementById('chat-action-notice'); if (notice) notice.textContent = r.body.error || 'The chat could not be ended.'; return; }
        state.ended = true; poll();
      }).catch(function () { end.disabled = false; var notice = doc.getElementById('chat-action-notice'); if (notice) notice.textContent = 'Connection interrupted. Please try again.'; });
    });
    controls.appendChild(transcript); controls.appendChild(end);
    var actionNotice = el('div', { class: 'note chat-action-notice', id: 'chat-action-notice', role: 'status', 'aria-live': 'polite' });
    note.appendChild(doc.createTextNode('This chat has ended. ')); note.appendChild(again);
    main.appendChild(assignment); main.appendChild(controls); main.appendChild(actionNotice); main.appendChild(log); main.appendChild(typing); main.appendChild(note); main.appendChild(form);
    var post = function () { var text = ta.value.trim(); if (!text) return; send.disabled = true; api('send?org=' + encodeURIComponent(org), { number: state.number, token: state.token, message: text }).then(function (r) { send.disabled = false; if (!r.ok) { log.appendChild(el('div', { class: 'note', role: 'alert', text: (r.body.error || 'Not sent.') + (r.requestId ? ' Reference: ' + r.requestId : '') })); if (r.status === 409) { store.set(null); } else { ta.value = text; ta.focus(); } return; } ta.value = ''; poll(); }).catch(function () { send.disabled = false; ta.value = text; ta.focus(); log.appendChild(el('div', { class: 'note', role: 'alert', text: 'Connection interrupted. Your message is still here; please try sending it again.' })); }); };
    form.addEventListener('submit', function (e) { e.preventDefault(); post(); });
    ta.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); post(); } });
    poll();
  }
  function stop() { if (timer) { root.clearTimeout(timer); timer = null; } }
  function poll() {
    stop();
    api('poll?org=' + encodeURIComponent(org) + '&n=' + state.number + '&t=' + encodeURIComponent(state.token) + '&after=' + state.last).then(function (r) {
      if (r.status === 403 || r.status === 404) { store.set(null); return start(); }
      if (r.ok) {
        var warning = doc.getElementById('chat-connection-warning'); if (warning) warning.remove();
        var log = doc.getElementById('log'); if (!log) return;
        r.body.messages.forEach(function (m) { state.last = Math.max(state.last, m.id); var b = bubble(m); if (b) log.appendChild(b); });
        if (r.body.messages.length) log.scrollTop = log.scrollHeight;
        var ended = doc.getElementById('ended'), form = main.querySelector('form.send'), controls = main.querySelector('.chat-actions'), typing = doc.getElementById('chat-typing'), assignment = doc.getElementById('chat-assignment');
        if (assignment) { assignment.textContent = r.body.assigned ? 'You’re chatting with ' + (r.body.agentName || 'a support agent') : 'Waiting for an agent to join…'; assignment.classList.toggle('is-assigned', r.body.assigned === true); }
        if (typing) { if (r.body.agentTyping) typing.removeAttribute('hidden'); else typing.setAttribute('hidden', 'hidden'); }
        if (ended) { if (r.body.ended) ended.removeAttribute('hidden'); else ended.setAttribute('hidden', 'hidden'); }
        if (form) form.style.display = r.body.ended ? 'none' : ''; if (controls) controls.style.display = r.body.ended ? 'none' : ''; if (r.body.ended && ended) ended.firstChild.textContent = 'This chat has ended. ';
      }
      timer = root.setTimeout(poll, doc.hidden ? 15000 : 3000);
    }).catch(function (e) { reportFailure('ChatPollNetworkError', e && e.message || 'Unable to refresh chat', e && e.stack, '/api/chat/poll'); var log = doc.getElementById('log'); if (log && !doc.getElementById('chat-connection-warning')) log.appendChild(el('div', { class: 'note', id: 'chat-connection-warning', role: 'status', text: 'Connection interrupted. Reconnecting…' })); timer = root.setTimeout(poll, 8000); });
  }
  api('config?org=' + encodeURIComponent(org)).then(function (r) {
    if (!r.ok || !r.body.enabled) { main.appendChild(el('div', { class: 'note', text: 'Chat is not available right now.' })); return; }
    cfg = r.body; doc.documentElement.style.setProperty('--c', cfg.color); var head = doc.getElementById('head'), brand = el('img', { class: 'chat-brand', src: cfg.logo || '/brand/mark.svg', alt: '' }); brand.addEventListener('error', function () { if (brand.getAttribute('src') !== '/brand/mark.svg') brand.setAttribute('src', '/brand/mark.svg'); else brand.hidden = true; }); head.insertBefore(brand, doc.getElementById('title')); doc.getElementById('title').textContent = cfg.title; doc.title = cfg.title;
    var saved = store.get(); if (saved && saved.number && saved.token) { state = { number: saved.number, token: saved.token, last: 0, ended: false }; conversation(); } else start();
  }).catch(function () { main.appendChild(el('div', { class: 'note', text: 'Chat is not available right now.' })); });
})(typeof window !== 'undefined' ? window : globalThis);
