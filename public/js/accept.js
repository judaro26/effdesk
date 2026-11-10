// public/js/accept.js: accepts an invitation (the person must be signed in with the invited address; otherwise they are sent to sign in first).
(function (root) {
  'use strict';
  function start(doc, fetchFn, nav) {
    var id = new URLSearchParams(nav.search).get('id') || '', t = doc.getElementById('t');
    if (!id) { t.textContent = 'This invitation link is not valid.'; return Promise.resolve(); }
    return fetchFn('/api/me', { credentials: 'same-origin' }).then(function (r) {
      if (r.status === 401) { t.textContent = 'Sign in or create an account with the email address that was invited, then open this link again.'; var a = doc.createElement('a'); a.className = 'btn'; a.href = '/auth.html?mode=signup'; a.textContent = 'Create an account'; var b = doc.createElement('a'); b.className = 'btn l'; b.href = '/auth.html?mode=signin'; b.textContent = 'Sign in'; doc.getElementById('a').appendChild(a); doc.getElementById('a').appendChild(doc.createTextNode(' ')); doc.getElementById('a').appendChild(b); return; }
      return fetchFn('/api/auth/organization/accept-invitation', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ invitationId: id }) }).then(function (x) { if (x.ok) { t.textContent = 'You joined the team.'; nav.go('/app.html'); } else x.json().catch(function () { return {}; }).then(function (j) { t.textContent = (j && j.message) || 'This invitation did not work. It may have expired or been sent to another address.'; }); });
    });
  }
  root.SundeskAccept = { start: start };
  if (root.document && root.document.getElementById('t') && !root.__SUNDESK_TEST__) start(root.document, root.fetch.bind(root), { search: root.location.search, go: function (u) { root.location.assign(u); } });
})(typeof window !== 'undefined' ? window : this);
