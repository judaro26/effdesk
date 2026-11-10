// public/js/chat.js: THE CHAT WINDOW (inside the widget's frame): a short form to start, then the conversation. It asks for new messages every few seconds while it is open.
(function (root) {
  'use strict';
  var doc = root.document, q = new URLSearchParams(root.location.search), org = q.get('org') || '', KEY = 'effdesk_chat_' + org;
  var main = doc.getElementById('main'), state = { number: 0, token: '', last: 0, ended: false }, timer = null, seen = {};
  var el = function (tag, attrs) { var e = doc.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }); [].slice.call(arguments, 2).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
  var store = { get: function () { try { return JSON.parse(root.localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }, set: function (v) { try { if (v) root.localStorage.setItem(KEY, JSON.stringify(v)); else root.localStorage.removeItem(KEY); } catch (e) { } } };
  var api = function (path, body) { return root.fetch('/api/chat/' + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.assign({}, body)) } : undefined).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
  var clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); };
  var cfg = null;
  function start() {
    clear(main); stop();
    var name = el('input', { 'aria-label': 'Your name', placeholder: 'Your name', maxlength: '100', autocomplete: 'name' }), email = el('input', { 'aria-label': 'Your email', placeholder: 'you@example.com', type: 'email', maxlength: '254', autocomplete: 'email' });
    var msg = el('textarea', { 'aria-label': 'Your message', placeholder: 'How can we help?', maxlength: '2000', rows: '3' }), err = el('div', { class: 'err', role: 'alert' }), go = el('button', { type: 'submit', text: 'Start chat' });
    var form = el('form', {}, el('div', { class: 'note', text: cfg.greeting }), name, email, msg, err, go);
    form.addEventListener('submit', function (e) {
      e.preventDefault(); err.textContent = ''; go.disabled = true;
      api('start?org=' + encodeURIComponent(org), { name: name.value, email: email.value, message: msg.value }).then(function (r) {
        go.disabled = false; if (!r.ok) { err.textContent = r.body.error || 'The chat could not start.'; return; }
        state = { number: r.body.number, token: r.body.token, last: 0, ended: false }; seen = {}; store.set({ number: state.number, token: state.token }); conversation();
      }).catch(function () { go.disabled = false; err.textContent = 'No connection. Try again.'; });
    });
    main.appendChild(form); name.focus();
  }
  function bubble(m) {
    if (seen[m.id]) return null; seen[m.id] = 1;
    var b = el('div', { class: 'b ' + m.from, 'data-id': String(m.id) });
    if (m.from === 'agent' && m.name) b.appendChild(el('div', { class: 'who', text: m.name }));
    if (root.EffFormat) root.EffFormat.toDom(doc, m.body, b); else b.appendChild(el('p', { text: m.body }));
    return b;
  }
  function conversation() {
    clear(main);
    var log = el('div', { class: 'log', id: 'log', role: 'log' }), note = el('div', { class: 'note', id: 'ended', hidden: 'hidden' });
    var ta = el('textarea', { 'aria-label': 'Message', placeholder: 'Write a message', rows: '1', maxlength: '2000' }), send = el('button', { type: 'submit', text: 'Send' }), form = el('form', { class: 'send' }, ta, send);
    var again = el('button', { type: 'button', class: 'link', text: 'Start a new chat' }); again.addEventListener('click', function () { store.set(null); state = { number: 0, token: '', last: 0, ended: false }; start(); });
    note.appendChild(doc.createTextNode('This chat has ended. ')); note.appendChild(again);
    main.appendChild(log); main.appendChild(note); main.appendChild(form);
    var post = function () { var text = ta.value.trim(); if (!text) return; send.disabled = true; api('send?org=' + encodeURIComponent(org), { number: state.number, token: state.token, message: text }).then(function (r) { send.disabled = false; if (!r.ok) { log.appendChild(el('div', { class: 'note', text: r.body.error || 'Not sent.' })); if (r.status === 409) { store.set(null); } return; } ta.value = ''; poll(); }).catch(function () { send.disabled = false; }); };
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
        var log = doc.getElementById('log'); if (!log) return;
        r.body.messages.forEach(function (m) { state.last = Math.max(state.last, m.id); var b = bubble(m); if (b) log.appendChild(b); });
        if (r.body.messages.length) log.scrollTop = log.scrollHeight;
        var ended = doc.getElementById('ended'), form = main.querySelector('form.send');
        if (ended) { if (r.body.ended) ended.removeAttribute('hidden'); else ended.setAttribute('hidden', 'hidden'); }
        if (form) form.style.display = r.body.ended ? 'none' : '';
      }
      timer = root.setTimeout(poll, doc.hidden ? 15000 : 3000);
    }).catch(function () { timer = root.setTimeout(poll, 8000); });
  }
  api('config?org=' + encodeURIComponent(org)).then(function (r) {
    if (!r.ok || !r.body.enabled) { main.appendChild(el('div', { class: 'note', text: 'Chat is not available right now.' })); return; }
    cfg = r.body; doc.documentElement.style.setProperty('--c', cfg.color); doc.getElementById('title').textContent = cfg.title; doc.title = cfg.title;
    var saved = store.get(); if (saved && saved.number && saved.token) { state = { number: saved.number, token: saved.token, last: 0, ended: false }; conversation(); } else start();
  }).catch(function () { main.appendChild(el('div', { class: 'note', text: 'Chat is not available right now.' })); });
})(typeof window !== 'undefined' ? window : globalThis);
