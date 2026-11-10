// public/widget.js: THE CHAT BUTTON FOR A CUSTOMER'S WEBSITE. One line on their page:
//   <script src="https://app.effdesk.com/widget.js" data-org="their-workspace" async></script>
// It adds a round button; clicking it opens the chat (a small page from EffDesk, in a frame, so nothing from the host page can read the conversation).
(function () {
  'use strict';
  var me = document.currentScript || [].slice.call(document.scripts).filter(function (s) { return /widget\.js/.test(s.src) && s.getAttribute('data-org'); }).pop();
  if (!me || window.__effdeskChat) return; window.__effdeskChat = true;
  var org = me.getAttribute('data-org'), origin = new URL(me.src, location.href).origin;
  if (!org) return;
  fetch(origin + '/api/chat/config?org=' + encodeURIComponent(org)).then(function (r) { return r.json(); }).then(function (cfg) {
    if (!cfg || !cfg.enabled) return;
    var btn = document.createElement('button'), frame = null, open = false;
    btn.type = 'button'; btn.setAttribute('aria-label', cfg.title || 'Chat with us'); btn.setAttribute('aria-expanded', 'false'); btn.textContent = '💬';
    btn.style.cssText = 'position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:' + (cfg.color || '#1f73b7') + ';color:#fff;font-size:26px;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:2147483646';
    function toggle() {
      open = !open;
      if (!frame) {
        frame = document.createElement('iframe'); frame.title = cfg.title || 'Chat'; frame.src = origin + '/chat.html?org=' + encodeURIComponent(org);
        frame.style.cssText = 'position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);border:0;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.3);background:#fff;z-index:2147483647';
        document.body.appendChild(frame);
      }
      frame.style.display = open ? 'block' : 'none'; btn.setAttribute('aria-expanded', String(open)); btn.textContent = open ? '✕' : '💬';
    }
    btn.addEventListener('click', toggle); document.body.appendChild(btn);
  }).catch(function () { });
})();
