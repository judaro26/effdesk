// public/js/auth.js: the sign-in, sign-up, forgot-password and reset-password page. Talks to Better Auth at /api/auth/*. Draws text only.
(function (root) {
  'use strict';
  var MODES = { signin: 'Sign in', signup: 'Create your account', forgot: 'Forgot your password', reset: 'Choose a new password', twofactor: 'Two-step verification' };
  function start(doc, fetchFn, nav) {
    var qs = new URLSearchParams(nav.search), mode = MODES[qs.get('mode')] && qs.get('mode') !== 'twofactor' ? qs.get('mode') : 'signin', token = qs.get('token') || '';
    if (token) mode = 'reset';
    var $ = function (id) { return doc.getElementById(id); }, msg = function (t, bad) { $('msg').textContent = t || ''; $('msg').className = 'msg' + (bad ? ' err' : ''); };
    function draw() {
      $('title').textContent = MODES[mode]; doc.title = MODES[mode] + ' | EffDesk';
      [].forEach.call(doc.querySelectorAll('[data-for]'), function (n) { n.hidden = n.getAttribute('data-for').split(' ').indexOf(mode) < 0; });
      $('go').textContent = mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Save password' : 'Verify';
      var l = $('links'); while (l.firstChild) l.removeChild(l.firstChild);
      var add = function (text, m) { var a = doc.createElement('a'); a.href = '/auth.html?mode=' + m; a.textContent = text; l.appendChild(a); l.appendChild(doc.createTextNode(' ')); };
      if (mode === 'signin') { add('Create an account', 'signup'); add('Forgot your password?', 'forgot'); var sso = doc.createElement('a'); sso.href = '#'; sso.setAttribute('data-sso', '1'); sso.textContent = 'Sign in with SSO'; sso.addEventListener('click', function (e) { e.preventDefault(); var em = $('email').value.trim(); if (!/^\S+@\S+\.\S+$/.test(em)) return msg('Enter your work email above, then choose Sign in with SSO.', true); (nav.go || function (u) { root.location.assign(u); })('/api/auth/sso/start?email=' + encodeURIComponent(em)); }); l.appendChild(sso); } else if (mode === 'signup' || mode === 'forgot') add('Sign in instead', 'signin');
    }
    function post(path, body) {
      return fetchFn('/api/auth' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
    }
    var get = function (path) { return fetchFn(path, { credentials: 'same-origin' }).then(function (r) { return r.json().catch(function () { return {}; }); }); };
    var slugOk = false, slugTouched = false, slugTimer = null, slugSeq = 0;
    var normSlug = function (v) { return String(v || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); };
    function checkSlug() {
      var v = normSlug($('slug').value), seq = ++slugSeq, note = $('slugnote'); slugOk = false;
      if (v.length < 3) { note.className = 'm'; note.textContent = 'Use at least 3 letters or numbers. Your help center will be at app.effdesk.com/help/' + (v || 'your-address'); return; }
      note.className = 'm'; note.textContent = 'Checking ' + v + '…';
      get('/api/workspace-check?slug=' + encodeURIComponent(v) + '&email=' + encodeURIComponent(($('email') && $('email').value || '').trim())).then(function (r) { if (seq !== slugSeq) return; slugOk = !!r.available; note.className = 'm ' + (r.available ? 'ok' : 'err'); note.textContent = r.available ? v + ' is available. Your help center will be at app.effdesk.com/help/' + v : (r.reason || 'That address is not available.') ; }).catch(function () { if (seq === slugSeq) { note.className = 'm'; note.textContent = 'Could not check that address right now.'; } });
    }
    $('company').addEventListener('input', function () { if (!slugTouched) { $('slug').value = normSlug($('company').value); } clearTimeout(slugTimer); slugTimer = setTimeout(checkSlug, 300); });
    $('slug').addEventListener('input', function () { slugTouched = true; clearTimeout(slugTimer); slugTimer = setTimeout(checkSlug, 300); });
    $('email').addEventListener('change', function () { clearTimeout(slugTimer); slugTimer = setTimeout(checkSlug, 100); });
    var verifyEmail = '';
    function showDone(email, slug) { verifyEmail = email; $('f').hidden = true; $('done').hidden = false; $('doneemail').textContent = email; $('doneslug').textContent = '(' + slug + ')'; doc.title = 'Check your email | EffDesk'; }
    $('resend').addEventListener('click', function () { $('resend').disabled = true; post('/send-verification-email', { email: verifyEmail, callbackURL: '/welcome.html' }).then(function (r) { $('donemsg').textContent = r.ok ? 'Sent again. It can take a minute to arrive.' : fail(r); $('donemsg').className = 'msg' + (r.ok ? '' : ' err'); setTimeout(function () { $('resend').disabled = false; }, 30000); }).catch(function () { $('donemsg').textContent = 'Could not reach the server. Try again.'; $('donemsg').className = 'msg err'; $('resend').disabled = false; }); });
    var signedIn = function () { try { root.sessionStorage.setItem('effdesk.signedIn', String(Date.now())); } catch (e) { } };           // lets the next page tell "signed in but the browser dropped the session" from "never signed in"
    var fail = function (r) { return r.status === 403 && r.body && r.body.code === 'INVALID_ORIGIN' ? 'Sign-in is not allowed from this web address. Open app.effdesk.com and try again.' : r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : r.status === 403 && /verif/i.test(String(r.body.message || '')) ? 'Check your email and confirm your address first.' : r.status === 401 ? 'Those details did not work.' : (r.body && r.body.message) || 'That did not work. Try again.'; };
    $('f').addEventListener('submit', function (e) {
      e.preventDefault(); msg('');
      var email = $('email').value.trim(), pw = $('password').value, p;
      if (mode === 'signup') {
        if (!$('name').value.trim() || !/^\S+@\S+\.\S+$/.test(email)) return msg('Enter your name and a valid email.', true);
        if (pw.length < 10) return msg('Use at least 10 characters for the password.', true);
        if ($('company').value.trim().length < 2) return msg('Enter your company name.', true);
        var slug = normSlug($('slug').value); if (slug.length < 3) return msg('Choose your workspace address (3 or more letters or numbers).', true);
        if (!$('terms').checked) return msg('Please agree to the Terms and the Privacy Policy.', true);
        $('go').disabled = true; msg('Creating your account…');
        p = fetchFn('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ name: $('name').value.trim(), email: email, password: pw, company: $('company').value.trim(), slug: slug }) }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { $('go').disabled = false; if (!r.ok) { if (j.code === 'SLUG_TAKEN') { slugOk = false; $('slugnote').className = 'm err'; $('slugnote').textContent = j.message; return msg(j.message, true); } return msg(r.status === 422 || /exists|already/i.test(String(j.message || '')) ? 'There is already an account with that email. Sign in instead.' : r.status === 429 ? 'Too many attempts. Wait a minute and try again.' : j.message || 'That did not work. Try again.', true); } msg(''); showDone(email, j.slug || slug); }); });
      } else if (mode === 'signin') {
        $('go').disabled = true; msg('Signing you in…');
        p = post('/sign-in/email', { email: email, password: pw }).then(function (r) { if (r.ok && r.body.twoFactorRedirect) { $('go').disabled = false; mode = 'twofactor'; draw(); return msg('Enter the 6-digit code.'); } if (!r.ok) { $('go').disabled = false; return msg(fail(r), true); } signedIn(); msg('Signed in. Opening your workspace…'); nav.go('/welcome.html'); }, function (e) { $('go').disabled = false; throw e; });
      } else if (mode === 'twofactor') {
        $('go').disabled = true; msg('Checking the code…');
        p = post('/two-factor/verify-totp', { code: $('code').value.trim() }).then(function (r) { if (!r.ok) { $('go').disabled = false; return msg('That code did not work.', true); } signedIn(); msg('Signed in. Opening your workspace…'); nav.go('/welcome.html'); }, function (e) { $('go').disabled = false; throw e; });
      } else if (mode === 'forgot') {
        p = post('/request-password-reset', { email: email, redirectTo: '/auth.html?mode=reset' }).then(function () { msg('If there is an account with that email, a reset link is on its way.'); });
      } else {
        if (pw.length < 10) return msg('Use at least 10 characters for the password.', true);
        p = post('/reset-password', { newPassword: pw, token: token }).then(function (r) { if (!r.ok) return msg('That link has expired. Ask for a new one.', true); msg('Password changed. You can sign in now.'); nav.go('/auth.html?mode=signin'); });
      }
      return p && p.catch(function () { $('go').disabled = false; msg('Could not reach the server. Try again.', true); });
    });
    draw(); if (qs.get('sso_error')) msg(qs.get('sso_error'), true);
  }
  root.EffDeskAuth = { start: start };
  if (root.document && root.document.getElementById('f') && !root.__EFFDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); } });
})(typeof window !== 'undefined' ? window : this);
