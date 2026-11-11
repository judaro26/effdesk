// public/js/welcome.js: THE PAGE AFTER THE CONFIRMATION LINK: choose a plan, the workspace is created, billing details are taken by Paddle's checkout, and the person lands in their desk. Also the page every sign-in goes through: it sends people where they belong. Draws text only.
(function (root) {
  'use strict';
  var PLANS = { team: { name: 'Team', month: 8, year: 6, line: 'SLA timers, triggers, reports, CSAT' }, suite: { name: 'Suite', month: 23, year: 18, line: 'Everything in Team, plus help center, live chat, translation and AI helpers' }, pro: { name: 'Pro', month: 49, year: 39, line: 'Everything in Suite, plus single sign-on (audit log, data export and custom roles coming)' } };
  function start(doc, fetchFn, nav, openCheckout, opts) {
    var pollMs = (opts && opts.pollMs) || 2000;
    var main = doc.getElementById('main'), me = null, state = { interval: 'year', seats: 3, note: '', bad: false, busy: false };
    var el = function (tag, props) { var e = doc.createElement(tag); Object.keys(props || {}).forEach(function (k) { if (k === 'class') e.className = props[k]; else if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), props[k]); else if (k === 'value') e.value = props[k]; else e.setAttribute(k, props[k]); }); [].concat.apply([], [].slice.call(arguments, 2)).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? doc.createTextNode(c) : c); }); return e; };
    var call = function (method, path, body) { return fetchFn(path, { method: method, headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); }); };
    var say = function (t, bad) { state.note = t; state.bad = !!bad; draw(); };
    var clear = function () { while (main.firstChild) main.removeChild(main.firstChild); };
    function route() {
      return call('GET', '/api/me').then(function (r) {
        if (r.status === 401) {
          var just = 0; try { just = Number(root.sessionStorage.getItem('effdesk.signedIn')) || 0; root.sessionStorage.removeItem('effdesk.signedIn'); } catch (e) { }
          if (just && Date.now() - just < 60000) { clear(); main.appendChild(el('h1', {}, 'You were signed in, but the session did not stay')); main.appendChild(el('p', {}, 'Your browser did not keep the sign-in. This happens when cookies are blocked for this site or when the page was opened from a different web address. Open app.effdesk.com, allow cookies, and sign in again.')); main.appendChild(el('p', {}, el('a', { class: 'btn', href: 'https://app.effdesk.com/auth.html?mode=signin' }, 'Go to app.effdesk.com'))); return; }
          return nav.go('/auth.html?mode=signin');
        }
        if (!r.ok || !r.body || !r.body.user) return failed();
        me = r.body; doc.getElementById('who').textContent = me.user.email;
        if (!me.user.emailVerified) { clear(); main.appendChild(el('h1', {}, 'Confirm your email first')); main.appendChild(el('p', {}, 'Open the link we emailed you, then come back.')); return; }
        if (me.pendingWorkspace && me.pendingWorkspace.ownerWorkspace) return create(null);          // our own workspace: no plan to choose, it gets the lifetime licence
        if (me.pendingWorkspace) return draw();
        if (me.organizations.length) return nav.go('/desk.html?org=' + encodeURIComponent(me.organizations[0].id));
        nav.go('/app.html');
      }).catch(failed);
    }
    function failed() {                                     // never sit on "Loading…" for ever: say so and offer a retry
      clear(); main.appendChild(el('h1', {}, 'We could not load your account'));
      main.appendChild(el('p', {}, 'Something went wrong on our side, or your connection dropped. Try again in a moment.'));
      main.appendChild(el('p', {}, el('button', { class: 'btn', type: 'button', 'data-retry-me': '1', onclick: function () { clear(); main.appendChild(el('p', { class: 'm' }, 'Loading…')); route(); } }, 'Try again'), ' ', el('a', { class: 'btn l', href: '/auth.html?mode=signin' }, 'Sign in again')));
    }
    function chooseFree() { create(null); }
    function create(paid) {
      if (state.busy) return; state.busy = true; say('Creating your workspace…');
      call('POST', '/api/workspace').then(function (r) {
        if (!r.ok) { state.busy = false; return say(r.body.error || 'That did not work. Try again.', true); }
        var org = r.body.organization;
        if (!paid) return nav.go('/desk.html?org=' + encodeURIComponent(org.id));
        return call('POST', '/api/billing/checkout', { orgId: org.id, plan: paid, interval: state.interval, seats: state.seats }).then(function (c) {
          state.busy = false;
          if (!c.ok) return say('Your workspace is ready on the free plan. The payment could not be started: ' + (c.body.error || 'try again from your account page.'), true), later(org);
          say('Opening the secure payment window…');
          openCheckout(c.body, function (what) { if (what === 'completed') activate(org); else if (what === 'closed') closed(org, c.body); });
        });
      }).catch(function () { state.busy = false; say('Could not reach the server. Try again.', true); });
    }
    function later(org) { main.appendChild(el('p', {}, el('a', { class: 'btn', href: '/desk.html?org=' + encodeURIComponent(org.id) }, 'Open my desk'))); }
    function closed(org, cfg) {
      clear(); main.appendChild(el('h1', {}, 'Your workspace is ready'));
      main.appendChild(el('p', {}, 'The payment was not completed, so you are on the free plan (2 agents). You can upgrade at any time from your account page.'));
      main.appendChild(el('p', {}, el('button', { class: 'btn', type: 'button', 'data-retry': '1', onclick: function () { openCheckout(cfg, function (w) { if (w === 'completed') activate(org); }); } }, 'Try the payment again'), ' ', el('a', { class: 'btn l', href: '/desk.html?org=' + encodeURIComponent(org.id) }, 'Open my desk')));
    }
    function activate(org) {
      clear(); main.appendChild(el('h1', {}, 'Thank you!')); var p = el('p', { role: 'status' }, 'Setting up your plan…'); main.appendChild(p); var tries = 0;
      (function poll() {
        call('GET', '/api/me').then(function (r) {
          var o = (r.body.organizations || []).filter(function (x) { return x.id === org.id; })[0];
          if (o && o.plan !== 'free') return nav.go('/desk.html?org=' + encodeURIComponent(org.id));
          if (++tries >= 30) { p.textContent = 'Your payment went through. Activating the plan can take a minute more: open your desk and it will update on its own.'; return later(org); }
          setTimeout(poll, pollMs);
        }).catch(function () { setTimeout(poll, 3000); });
      })();
    }
    function addressBox() {
      var pend = me.pendingWorkspace, input = el('input', { 'aria-label': 'Workspace address', value: pend.slug, maxlength: '40' });
      return el('p', { class: 'm' }, 'Workspace: ', el('strong', {}, pend.company), ' · address ', el('strong', {}, pend.slug), ' (help center at app.effdesk.com/help/' + pend.slug + ') ', el('details', { style: 'display:inline' }, el('summary', {}, 'Change address'), input, ' ', el('button', { class: 'btn l', type: 'button', 'data-change': '1', onclick: function () { call('PATCH', '/api/workspace', { slug: input.value }).then(function (r) { if (!r.ok) return say(r.body.error || 'That address is not available.', true); me.pendingWorkspace.slug = r.body.slug; say('Address changed to ' + r.body.slug + '.'); }); } }, 'Save')));
    }
    function draw() {
      if (!me || !me.pendingWorkspace) return;
      clear();
      main.appendChild(el('h1', {}, 'Choose your plan'));
      main.appendChild(addressBox());
      if (state.note) main.appendChild(el('p', { class: 'msg' + (state.bad ? ' err' : ''), role: 'status' }, state.note));
      var seats = el('input', { type: 'number', min: '1', max: '500', value: String(state.seats), 'aria-label': 'Agents', style: 'width:80px' });
      seats.addEventListener('change', function () { state.seats = Math.max(1, Math.min(500, parseInt(seats.value, 10) || 1)); draw(); });
      var iv = el('select', { 'aria-label': 'Billing' }, el('option', { value: 'year' }, 'Billed yearly (best price)'), el('option', { value: 'month' }, 'Billed monthly')); iv.value = state.interval;
      iv.addEventListener('change', function () { state.interval = iv.value; draw(); });
      main.appendChild(el('p', {}, 'Agents: ', seats, ' ', iv));
      var cards = [el('div', { class: 'card plan' }, el('h3', {}, 'Free'), el('div', { class: 'price' }, '$0'), el('p', { class: 'm' }, '2 agents, tickets, email, basic help center. No card needed.'), el('button', { class: 'btn l', type: 'button', 'data-plan': 'free', onclick: chooseFree }, 'Start free'))];
      Object.keys(PLANS).forEach(function (k) { var p = PLANS[k], per = p[state.interval]; cards.push(el('div', { class: 'card plan' + (k === 'suite' ? ' hot' : '') }, el('h3', {}, p.name), el('div', { class: 'price' }, '$' + per, el('small', {}, ' per agent per month')), el('p', { class: 'm' }, state.seats + ' agents: $' + per * state.seats + ' per month' + (state.interval === 'year' ? ', billed $' + per * state.seats * 12 + ' a year' : '')), el('p', { class: 'm' }, p.line), el('button', { class: 'btn', type: 'button', 'data-plan': k, onclick: function () { create(k); } }, 'Continue to payment'))); });
      main.appendChild(el('div', { class: 'plans' }, cards));
      main.appendChild(el('p', { class: 'm' }, 'Billing details are entered in the next step, in a secure window by Paddle, who handle payments and taxes for us. You can change or cancel your plan later.'));
    }
    return route();
  }
  // opens Paddle's checkout overlay and tells the page how it ended
  function paddleCheckout(doc, cfg, cb) {
    var done = false, open = function () { var P = root.Paddle; if (cfg.sandbox) P.Environment.set('sandbox'); P.Initialize({ token: cfg.clientToken, eventCallback: function (e) { if (!e) return; if (e.name === 'checkout.completed') { done = true; cb('completed'); } else if (e.name === 'checkout.closed' && !done) cb('closed'); } }); P.Checkout.open({ items: [{ priceId: cfg.priceId, quantity: cfg.quantity }], customData: cfg.customData, customer: { email: cfg.customerEmail } }); };
    if (root.Paddle) return open();
    var s = doc.createElement('script'); s.src = 'https://cdn.paddle.com/paddle/v2/paddle.js'; s.onload = open; doc.head.appendChild(s);
  }
  root.EffDeskWelcome = { start: start };
  if (root.document && root.document.getElementById('main') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { go: function (u) { root.location.assign(u); } }, function (cfg, cb) { paddleCheckout(root.document, cfg, cb); });
})(typeof window !== 'undefined' ? window : this);
