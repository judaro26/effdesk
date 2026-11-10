// public/help-widget.js: THE HELP SEARCH FOR A CUSTOMER'S WEBSITE. One line on their page:
//   <script src="https://app.effdesk.com/help-widget.js" data-org="their-workspace" async></script>
// A "Help" button opens a small box: the visitor types a question and sees matching articles from the help center, and a link to send a request.
// Options: data-lang="es", data-color="#1f73b7", data-position="left" (default right), data-label="Help", data-target="#some-id" (draw the search box inside that element instead of a button).
// Everything is drawn with text nodes only; articles open in the help center in a new tab.
(function () {
  'use strict';
  var me = document.currentScript || [].slice.call(document.scripts).filter(function (s) { return /help-widget\.js/.test(s.src) && s.getAttribute('data-org'); }).pop();
  if (!me || window.__effdeskHelp) return; window.__effdeskHelp = true;
  var org = me.getAttribute('data-org'), origin = new URL(me.src, location.href).origin, lang = me.getAttribute('data-lang') === 'es' ? 'es' : 'en';
  var color = /^#[0-9a-fA-F]{6}$/.test(me.getAttribute('data-color') || '') ? me.getAttribute('data-color') : '#1f73b7', left = me.getAttribute('data-position') === 'left';
  var L = lang === 'es' ? { label: 'Ayuda', ph: 'Busca una respuesta', none: 'No encontramos nada.', ask: 'Enviar una solicitud', err: 'No pudimos buscar ahora.', title: 'Centro de ayuda', hint: 'Escribe al menos 2 letras.' } : { label: 'Help', ph: 'Search for an answer', none: 'Nothing found.', ask: 'Send us a request', err: 'Search is not available right now.', title: 'Help center', hint: 'Type at least 2 letters.' };
  if (!org) return;
  var label = (me.getAttribute('data-label') || L.label).slice(0, 20), base = origin + '/help/' + encodeURIComponent(org);
  function h(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; }
  function build() {
    var box = h('div', 'font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1d2428;background:#fff;border:1px solid #d8dcdf;border-radius:12px;padding:12px;box-sizing:border-box;width:100%'), input = h('input', 'width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #c5cacd;border-radius:8px;font:inherit;color:inherit;background:#fff'), list = h('div', 'margin-top:8px;max-height:260px;overflow:auto'), ask = h('a', 'display:block;margin-top:10px;font-weight:600;color:' + color, L.ask), timer = 0, last = '';
    input.type = 'search'; input.placeholder = L.ph; input.setAttribute('aria-label', L.ph); input.maxLength = 100; ask.href = base + '/requests/new?lang=' + lang; ask.target = '_blank'; ask.rel = 'noopener';
    list.setAttribute('aria-live', 'polite');
    function show(items, request) {
      list.textContent = ''; if (!items.length) { list.appendChild(h('div', 'color:#5b6770;padding:6px 2px', L.none)); return; }
      items.forEach(function (a) { var l = h('a', 'display:block;padding:8px 6px;border-radius:6px;text-decoration:none;color:inherit'), t = h('strong', 'display:block;color:' + color, a.title), x = h('span', 'display:block;color:#5b6770;font-size:13px', a.excerpt); l.href = a.url; l.target = '_blank'; l.rel = 'noopener'; l.appendChild(t); l.appendChild(x); l.addEventListener('mouseover', function () { l.style.background = '#f1f3f4'; }); l.addEventListener('mouseout', function () { l.style.background = 'transparent'; }); list.appendChild(l); });
      if (request) ask.href = request;
    }
    function search() {
      var q = input.value.trim(); if (q === last) return; last = q;
      if (q.length < 2) { list.textContent = ''; if (q.length) list.appendChild(h('div', 'color:#5b6770;padding:6px 2px', L.hint)); return; }
      fetch(base + '/api/search?lang=' + lang + '&q=' + encodeURIComponent(q)).then(function (r) { return r.json(); }).then(function (j) { if (input.value.trim() === q) show(j.results || [], j.request); }).catch(function () { list.textContent = ''; list.appendChild(h('div', 'color:#b4232f;padding:6px 2px', L.err)); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(search, 250); });
    box.appendChild(input); box.appendChild(list); box.appendChild(ask); box.__input = input; return box;
  }
  var target = me.getAttribute('data-target'), host = target && document.querySelector(target);
  if (host) { host.appendChild(build()); return; }
  var btn = h('button', 'position:fixed;bottom:20px;' + (left ? 'left' : 'right') + ':20px;z-index:2147483000;border:0;border-radius:999px;background:' + color + ';color:#fff;font:600 15px system-ui,-apple-system,sans-serif;padding:12px 20px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25)', label), panel = h('div', 'position:fixed;bottom:76px;' + (left ? 'left' : 'right') + ':20px;z-index:2147483000;width:340px;max-width:calc(100vw - 24px);display:none;box-shadow:0 8px 30px rgba(0,0,0,.28);border-radius:12px'), box = build(), open = false;
  btn.type = 'button'; btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-label', L.title); panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', L.title); panel.appendChild(box);
  btn.addEventListener('click', function () { open = !open; panel.style.display = open ? 'block' : 'none'; btn.setAttribute('aria-expanded', String(open)); if (open) box.__input.focus(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && open) { open = false; panel.style.display = 'none'; btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
  document.body.appendChild(panel); document.body.appendChild(btn);
})();
