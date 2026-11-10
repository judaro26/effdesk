// public/js/print.js: the print page's button, and opening the print dialog straight away when asked.
(function () {
  var b = document.getElementById('print'); if (b) b.addEventListener('click', function () { window.print(); });
  var s = document.currentScript; if (s && s.getAttribute('data-auto') === '1') window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });
})();
