// public/js/auth.js: the sign-in, sign-up, forgot-password and reset-password page. Talks to Better Auth at /api/auth/*. Draws text only.
(function (root) {
  'use strict';
  var MODES = { signin: 'Sign in', signup: 'Create your account', forgot: 'Forgot your password', reset: 'Choose a new password', twofactor: 'Two-step verification' };
  function start(doc, fetchFn, nav) {
    var qs = new URLSearchParams(nav.search), mode = MODES[qs.get('mode')] && qs.get('mode') !== 'twofactor' ? qs.get('mode') : 'signin', token = qs.get('token') || '';
    if (token) mode = 'reset';
    var $ = function (id) { return doc.getElementById(id); }, msg = function (t, bad) { $('msg').textContent = t || ''; $('msg').className = 'msg' + (bad ? ' err' : ''); };
    function draw() {
      $('title').textContent = MODES[mode]; doc.title = MODES[mode] + ' | Sundesk';
      [].forEach.call(doc.querySelectorAll('[data-for]'), function (n) { n.hidden = n.getAttribute('data-for').split(' ').indexOf(mode) < 0; });
      $('go').textContent = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save password' : 'Verify';
      var l = $('links'); while (l.firstChild) l.removeChild(l.firstChild);
      var add = function (text, m) { var a = doc.createElement('a'); a.href = '/auth.html?mode=' + m; a.textContent = text; l.appendChild(a); l.appendChild(doc.createTextNode(' ')); };
      if (mode === 'signin') { add('Create an account', 'signup'); add('Forgot your password?', 'forgot'); } else if (mode === 'signup' || mode === 'forgot') add('Sign in instead', 'signin');
    }
    function post(path, body) {
      return fetchFn('/api/auth' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
    }
    var fail = function (r) { return r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : r.status === 403 && /verif/i.test(String(r.body.message || '')) ? 'Check your email and confirm your address first.' : r.status === 401 ? 'Those details did not work.' : (r.body && r.body.message) || 'That did not work. Try again.'; };
    $('f').addEventListener('submit', function (e) {
      e.preventDefault(); msg('');
      var email = $('email').value.trim(), pw = $('password').value, p;
      if (mode === 'signup') {
        if (!$('name').value.trim() || !/^\S+@\S+\.\S+$/.test(email)) return msg('Enter your name and a valid email.', true);
        if (pw.length < 10) return msg('Use at least 10 characters for the password.', true);
        if (!$('terms').checked) return msg('Please agree to the Terms and the Privacy Policy.', true);
        p = post('/sign-up/email', { name: $('name').value.trim(), email: email, password: pw }).then(function (r) { if (!r.ok) return msg(r.status === 422 ? 'There is already an account with that email.' : fail(r), true); msg('Check your email for a link to confirm your address.'); $('go').disabled = true; });
      } else if (mode === 'signin') {
        p = post('/sign-in/email', { email: email, password: pw }).then(function (r) { if (r.ok && r.body.twoFactorRedirect) { mode = 'twofactor'; draw(); return msg('Enter the 6-digit code.'); } if (!r.ok) return msg(fail(r), true); nav.go('/app.html'); });
      } else if (mode === 'twofactor') {
        p = post('/two-factor/verify-totp', { code: $('code').value.trim() }).then(function (r) { if (!r.ok) return msg('That code did not work.', true); nav.go('/app.html'); });
      } else if (mode === 'forgot') {
        p = post('/request-password-reset', { email: email, redirectTo: '/auth.html?mode=reset' }).then(function () { msg('If there is an account with that email, a reset link is on its way.'); });
      } else {
        if (pw.length < 10) return msg('Use at least 10 characters for the password.', true);
        p = post('/reset-password', { newPassword: pw, token: token }).then(function (r) { if (!r.ok) return msg('That link has expired. Ask for a new one.', true); msg('Password changed. You can sign in now.'); nav.go('/auth.html?mode=signin'); });
      }
      return p && p.catch(function () { msg('Could not reach the server. Try again.', true); });
    });
    draw();
  }
  root.SundeskAuth = { start: start };
  if (root.document && root.document.getElementById('f') && !root.__SUNDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); } });
})(typeof window !== 'undefined' ? window : this);
