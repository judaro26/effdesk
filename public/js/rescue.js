// public/js/rescue.js: a confirmation link that lands on a page of the site instead of on the confirmation endpoint is passed on to it (so an older or mangled link still works).
(function (root) {
  'use strict';
  var q = new URLSearchParams(root.location.search);
  if (q.get('token') && q.get('callbackURL') && !/auth\.html$/.test(root.location.pathname)) root.location.replace('/api/auth/verify-email' + root.location.search);
})(window);
