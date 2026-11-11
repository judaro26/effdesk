// public/js/error-report.js: tells us when a script breaks in someone's browser (a message, the page and the first lines of the stack; nothing the person typed). At most 5 reports per page view.
(function (w) {
  'use strict';
  var sent = 0, seen = {};
  function report(name, message, stack) {
    try {
      var key = name + message; if (sent >= 5 || seen[key]) return; seen[key] = 1; sent++;
      var body = JSON.stringify({ name: String(name || 'Error').slice(0, 80), message: String(message || '').slice(0, 300), stack: String(stack || '').split('\n').slice(0, 6).join('\n').slice(0, 1200), page: w.location.pathname });
      if (w.navigator && w.navigator.sendBeacon) w.navigator.sendBeacon('/api/client-log', new w.Blob([body], { type: 'application/json' }));
      else w.fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    } catch (e) { /* reporting must never break the page */ }
  }
  w.addEventListener('error', function (e) { if (!e || !e.message || /^Script error\.?$/.test(e.message)) return; report(e.error && e.error.name, e.message, e.error && e.error.stack); });
  w.addEventListener('unhandledrejection', function (e) { var r = e && e.reason; report((r && r.name) || 'UnhandledRejection', (r && r.message) || String(r), r && r.stack); });
})(window);
