// public/js/app.js: the account page: your organizations, plan and seats, inviting agents, upgrading (Paddle checkout). Draws text only.
(function (root) {
  'use strict';
  function start(doc, fetchFn, nav, loadPaddle) {
    var main = doc.getElementById('main'), me = null, note = '', bad = false;
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else e.setAttribute(k, props[k]); }); [].slice.call(arguments, 2).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
    var call = function (method, path, body) { return fetchFn(path, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var say = function (t, isBad) { note = t; bad = !!isBad; draw(); };
    function load() { return call('GET', '/api/me').then(function (r) { if (r.status === 401) return nav.go('/auth.html?mode=signin'); me = r.body; doc.getElementById('who').textContent = me.user.email; draw(); }); }
    function orgCard(o) {
      var email = el('input', { type: 'email', 'aria-label': 'Agent email', placeholder: 'agent@yourcompany.com' });
      var seats = el('input', { type: 'number', min: '1', max: '500', value: String(Math.max(3, o.seatsUsed)), 'aria-label': 'Seats', style: 'width:80px' });
      var plan = el('select', { 'aria-label': 'Plan' }, el('option', { value: 'team' }, 'Team ($6)'), el('option', { value: 'suite' }, 'Suite ($18)'), el('option', { value: 'pro' }, 'Pro ($39)'));
      var iv = el('select', { 'aria-label': 'Billing' }, el('option', { value: 'year' }, 'Billed yearly'), el('option', { value: 'month' }, 'Billed monthly'));
      var canBill = o.role === 'owner' || o.role === 'admin';
      return el('div', { class: 'card', 'data-org': o.id, style: 'margin:16px 0' }, el('h3', {}, o.name),
        el('p', { class: 'm' }, 'Plan: ' + (o.license ? 'Lifetime licence' : o.plan) + ' · Agents: ' + o.seatsUsed + (o.seats == null ? ' (unlimited)' : ' of ' + o.seats) + ' · Your role: ' + o.role),
        canBill ? el('div', {}, el('h4', {}, 'Invite an agent'), email, ' ', el('button', { class: 'btn l', type: 'button', 'data-invite': o.id, onclick: function () { call('POST', '/api/auth/organization/invite-member', { email: email.value.trim(), role: 'member', organizationId: o.id }).then(function (r) { if (!r.ok) return say(r.body.message || 'That did not work.', true); say('Invitation sent to ' + email.value.trim() + '.'); load(); }); } }, 'Send invitation')) : null,
        canBill && !o.license ? el('div', {}, el('h4', {}, 'Change plan'), plan, ' ', seats, ' agents ', iv, ' ', el('button', { class: 'btn', type: 'button', 'data-upgrade': o.id, onclick: function () { call('POST', '/api/billing/checkout', { orgId: o.id, plan: plan.value, interval: iv.value, seats: Number(seats.value) }).then(function (r) { if (!r.ok) return say(r.body.error || 'That did not work.', true); loadPaddle(r.body); }); } }, 'Continue to checkout')) : null);
    }
    function draw() {
      while (main.firstChild) main.removeChild(main.firstChild);
      if (!me) return main.appendChild(el('p', { class: 'm' }, 'Loading…'));
      main.appendChild(el('h1', {}, 'Your account'));
      if (note) main.appendChild(el('p', { class: 'msg' + (bad ? ' err' : ''), role: 'status' }, note));
      me.organizations.forEach(function (o) { main.appendChild(orgCard(o)); });
      var name = el('input', { 'aria-label': 'Organization name', placeholder: 'Your company', maxlength: '60' });
      main.appendChild(el('div', { class: 'card' }, el('h3', {}, me.organizations.length ? 'Create another organization' : 'Create your organization'), name, ' ', el('button', { class: 'btn', type: 'button', 'data-create-org': '1', onclick: function () {
        var n = name.value.trim(); if (n.length < 2) return say('Give the organization a name.', true);
        var slug = n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) + '-' + Math.random().toString(36).slice(2, 6);
        call('POST', '/api/auth/organization/create', { name: n, slug: slug }).then(function (r) { if (!r.ok) return say(r.body.message || 'That did not work.', true); say('Organization created.'); load(); });
      } }, 'Create')));
    }
    doc.getElementById('out').addEventListener('click', function () { call('POST', '/api/auth/sign-out', {}).then(function () { nav.go('/'); }); });
    return load();
  }
  // opens Paddle's checkout overlay (the script comes from Paddle only on this page)
  function paddleOverlay(doc, cfg) {
    var open = function () { var P = root.Paddle; if (cfg.sandbox) P.Environment.set('sandbox'); P.Initialize({ token: cfg.clientToken }); P.Checkout.open({ items: [{ priceId: cfg.priceId, quantity: cfg.quantity }], customData: cfg.customData, customer: { email: cfg.customerEmail } }); };
    if (root.Paddle) return open();
    var s = doc.createElement('script'); s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js'; s.onload = open; doc.head.appendChild(s);
  }
  root.SundeskApp = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__SUNDESK_TEST__) start(root.document, root.fetch.bind(root), { go: function (u) { root.location.assign(u); } }, function (cfg) { paddleOverlay(root.document, cfg); });
})(typeof window !== 'undefined' ? window : this);
