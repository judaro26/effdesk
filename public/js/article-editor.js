// public/js/article-editor.js: THE HELP ARTICLE EDITOR. What you see is what customers get: headings, bold, italic, lists, quotes, links, code, tables, call-out boxes, pictures (uploaded, dragged in or pasted), video (YouTube, Vimeo, Loom) and, on paid plans, HTML source and PDF import.
//   EffArticleEditor.create(doc, { html, canSource, canImport, upload(file) -> Promise<url>, importPdf(file) -> Promise<{ html, title }>, say(text, bad) }) -> { el, getHtml(), setHtml(html), clean(html) }
//   Everything that enters the editor (stored text, pasted HTML, the source box, an import) passes through clean(): an inert parse with an allow-list, so nothing runs. The server cleans again before saving and before showing.
(function (root) {
  'use strict';
  var TAGS = 'h2 h3 h4 p br hr strong b em i u s del sub sup code pre blockquote ul ol li a img figure figcaption table thead tbody tr th td div span iframe video details summary mark kbd'.split(' ');
  var ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], iframe: ['src', 'title'], video: ['src', 'controls'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] };
  var CLASSES = ['callout', 'info', 'tip', 'warning', 'danger', 'video', 'img-s', 'img-m', 'img-l', 'center', 'right', 'lead', 'steps', 'btn'];
  var VIDEO_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com', 'www.loom.com'];
  var RENAME = { H1: 'h2', H5: 'h4', H6: 'h4' };
  var DROP_WITH_CONTENT = ['script', 'style', 'noscript', 'template', 'object', 'embed', 'form', 'select', 'textarea', 'button', 'input', 'svg', 'math', 'head', 'title', 'meta', 'link'];

  function embedUrl(url) {
    var u; try { u = new URL(String(url).trim()); } catch (e) { return null; }
    if (u.protocol !== 'https:') return null;
    var h = u.hostname.replace(/^www\./, ''), m;
    if (h === 'youtu.be') { var id = u.pathname.slice(1); return /^[\w-]{6,20}$/.test(id) ? 'https://www.youtube-nocookie.com/embed/' + id : null; }
    if (h === 'youtube.com' || h === 'youtube-nocookie.com') { var v = u.searchParams.get('v') || ((u.pathname.match(/^\/(?:embed|shorts)\/([\w-]{6,20})/) || [])[1]); return v && /^[\w-]{6,20}$/.test(v) ? 'https://www.youtube-nocookie.com/embed/' + v : null; }
    if (h === 'vimeo.com' || h === 'player.vimeo.com') { m = u.pathname.match(/(\d{5,12})/); return m ? 'https://player.vimeo.com/video/' + m[1] : null; }
    if (h === 'loom.com') { m = u.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{20,40})/); return m ? 'https://www.loom.com/embed/' + m[1] : null; }
    return null;
  }
  var okHref = function (v) { v = String(v || '').trim(); return /^(https?:|mailto:|#|\/(?!\/))/i.test(v); };
  var okImg = function (v) { v = String(v || '').trim(); return /^https:\/\//i.test(v) || /^\/(help\/[a-z0-9-]{1,60}\/)?img\/[a-f0-9-]{36}$/.test(v); };

  function create(doc, opts) {
    opts = opts || {};
    var win = doc.defaultView || root;
    var el = function (tag, attrs, text) { var e = doc.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k.indexOf('on') === 0) e.addEventListener(k.slice(2), attrs[k]); else e.setAttribute(k, attrs[k]); }); if (text != null) e.textContent = text; return e; };
    var say = function (t, bad) { if (opts.say) opts.say(t, bad); };

    // ---- clean: html text in, safe html text out (inert parse)
    function clean(html) {
      var parsed = new win.DOMParser().parseFromString('<!doctype html><body>' + String(html || ''), 'text/html'), out = doc.createElement('div');
      (function walk(from, to) {
        for (var n = from.firstChild; n; n = n.nextSibling) {
          if (n.nodeType === 3) { to.appendChild(doc.createTextNode(n.nodeValue)); continue; }
          if (n.nodeType !== 1) continue;
          var tag = n.nodeName.toLowerCase(); if (RENAME[n.nodeName]) tag = RENAME[n.nodeName];
          if (DROP_WITH_CONTENT.indexOf(tag) >= 0) continue;
          if (TAGS.indexOf(tag) < 0) { walk(n, to); continue; }                        // unknown tag: keep its text
          if (tag === 'iframe') { var s = n.getAttribute('src') || '', ok = false; try { var uu = new URL(s); ok = uu.protocol === 'https:' && VIDEO_HOSTS.indexOf(uu.hostname) >= 0 && (uu.pathname.indexOf('/embed/') === 0 || uu.hostname === 'player.vimeo.com'); } catch (e) { } if (!ok) continue; }
          if (tag === 'img' && !okImg(n.getAttribute('src'))) continue;
          if (tag === 'video' && !/^https:\/\//i.test(n.getAttribute('src') || '')) continue;
          if (tag === 'a' && !okHref(n.getAttribute('href'))) { walk(n, to); continue; }
          var c = doc.createElement(tag);
          (ATTRS[tag] || []).forEach(function (a) { var v = n.getAttribute(a); if (v == null) return; if ((a === 'width' || a === 'height') && !/^\d{1,4}$/.test(v)) return; c.setAttribute(a, v); });
          var cls = (n.getAttribute('class') || '').split(/\s+/).filter(function (x) { return CLASSES.indexOf(x) >= 0; }); if (cls.length) c.setAttribute('class', cls.join(' '));
          if (tag === 'a') { c.setAttribute('rel', 'noopener noreferrer'); if (/^https?:/i.test(c.getAttribute('href'))) c.setAttribute('target', '_blank'); }
          if (tag === 'img') c.setAttribute('alt', n.getAttribute('alt') || '');
          if (tag === 'video') c.setAttribute('controls', '');
          to.appendChild(c); walk(n, c);
        }
      })(parsed.body, out);
      return out.innerHTML;
    }

    var wrap = el('div', { class: 'ae' }), bar = el('div', { class: 'ed-bar ae-bar', role: 'toolbar', 'aria-label': 'Article formatting' });
    var area = el('div', { class: 'ed-area ae-area hc-article', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Article text', 'data-article-editor': '1' });
    var src = el('textarea', { class: 'ae-src', 'aria-label': 'Article HTML', spellcheck: 'false', hidden: 'hidden', rows: '16' });
    var dlg = el('div', { class: 'ae-dlg', hidden: 'hidden' }), imgBar = el('div', { class: 'ae-dlg', hidden: 'hidden', 'data-image-bar': '1' }), picked = null, sourceMode = false;
    function setHtml(h) { area.innerHTML = clean(h) || '<p><br></p>'; }
    function getHtml() { if (sourceMode) applySource(); var h = clean(area.innerHTML); return /^(<p>(<br>)?<\/p>)?$/.test(h.trim()) ? '' : h; }
    try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
    function focusEnd() { area.focus(); }
    function exec(cmd, val) { area.focus(); try { doc.execCommand(cmd, false, val); } catch (e) { } }
    function insertHtml(h) { area.focus(); var safe = clean(h); try { if (!doc.execCommand('insertHTML', false, safe)) throw 0; } catch (e) { area.insertAdjacentHTML('beforeend', safe); } }

    function ask(label, placeholder, done, initial) {
      while (dlg.firstChild) dlg.removeChild(dlg.firstChild); dlg.removeAttribute('hidden');
      var input = el('input', { 'aria-label': label, placeholder: placeholder || '', maxlength: '500' }); input.value = initial || '';
      var go = function () { var v = input.value.trim(); dlg.setAttribute('hidden', 'hidden'); if (v) done(v); };
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); go(); } if (ev.key === 'Escape') dlg.setAttribute('hidden', 'hidden'); });
      dlg.appendChild(el('label', {}, label)); dlg.appendChild(input); dlg.appendChild(el('button', { type: 'button', class: 'btn sm', 'data-dialog-ok': '1', onclick: go }, 'Add')); dlg.appendChild(el('button', { type: 'button', class: 'btn l sm', onclick: function () { dlg.setAttribute('hidden', 'hidden'); } }, 'Cancel'));
      if (input.focus) input.focus();
    }
    var savedRange = null; function remember() { var s = win.getSelection && win.getSelection(); if (s && s.rangeCount && area.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange(); }
    function restore() { var s = win.getSelection && win.getSelection(); area.focus(); if (savedRange && s) { s.removeAllRanges(); s.addRange(savedRange); } }
    area.addEventListener('keyup', remember); area.addEventListener('mouseup', remember); area.addEventListener('blur', remember);

    function uploadFiles(files) {
      [].slice.call(files || []).filter(function (f) { return /^image\/(png|jpe?g|gif|webp)$/.test(f.type); }).forEach(function (f) {
        if (!opts.upload) return say('Pictures cannot be uploaded here.', true);
        say('Uploading ' + f.name + '…');
        opts.upload(f).then(function (url) { restore(); insertHtml('<figure><img src="' + url + '" alt=""></figure><p><br></p>'); say('Picture added. Click it to add a description for screen readers.'); }, function (e) { say(e && e.message || 'That picture could not be uploaded.', true); });
      });
    }
    area.addEventListener('drop', function (ev) { if (ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files.length) { ev.preventDefault(); uploadFiles(ev.dataTransfer.files); } });
    area.addEventListener('paste', function (ev) {
      var cd = ev.clipboardData; if (!cd) return;
      if (cd.files && cd.files.length) { ev.preventDefault(); return uploadFiles(cd.files); }
      var h = cd.getData && cd.getData('text/html'); if (h) { ev.preventDefault(); insertHtml(h); }       // pasted pages and documents come in cleaned
    });
    area.addEventListener('click', function (ev) { var t = ev.target; if (t && t.nodeName === 'IMG') pickImage(t); else if (!imgBar.contains(t)) { picked = null; imgBar.setAttribute('hidden', 'hidden'); } });
    function pickImage(img) {
      picked = img; while (imgBar.firstChild) imgBar.removeChild(imgBar.firstChild); imgBar.removeAttribute('hidden');
      var alt = el('input', { 'aria-label': 'Picture description', placeholder: 'Describe the picture (for screen readers)', maxlength: '200' }); alt.value = img.getAttribute('alt') || '';
      alt.addEventListener('input', function () { picked.setAttribute('alt', alt.value); });
      var size = function (label, cls) { return el('button', { type: 'button', class: 'btn l sm', 'data-img-size': cls || 'full', onclick: function () { picked.classList.remove('img-s', 'img-m', 'img-l'); if (cls) picked.classList.add(cls); } }, label); };
      imgBar.appendChild(alt); imgBar.appendChild(size('Small', 'img-s')); imgBar.appendChild(size('Medium', 'img-m')); imgBar.appendChild(size('Full width', null));
      imgBar.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-img-remove': '1', onclick: function () { var f = picked.closest('figure'); (f || picked).remove(); picked = null; imgBar.setAttribute('hidden', 'hidden'); } }, 'Remove'));
    }
    var fileIn = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', hidden: 'hidden', 'aria-label': 'Choose a picture', 'data-image-file': '1' });
    fileIn.addEventListener('change', function () { uploadFiles(fileIn.files); fileIn.value = ''; });
    var pdfIn = el('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: 'hidden', 'aria-label': 'Choose a PDF', 'data-pdf-file': '1' });
    pdfIn.addEventListener('change', function () {
      var f = pdfIn.files && pdfIn.files[0]; pdfIn.value = ''; if (!f) return;
      if (!opts.importPdf) return say('Importing a PDF is not available.', true);
      say('Reading ' + f.name + '… pictures and formatting are kept.');
      opts.importPdf(f).then(function (r) { if (sourceMode) toggleSource(); setHtml(r.html); say('Imported ' + (r.pages || '') + ' page' + (r.pages === 1 ? '' : 's') + (r.pictures ? ' and ' + r.pictures + ' picture' + (r.pictures === 1 ? '' : 's') : '') + '. Check it over, then save.' + (r.warnings && r.warnings.length ? ' ' + r.warnings.join(' ') : '')); if (opts.onTitle && r.title) opts.onTitle(r.title); }, function (e) { say(e && e.message || 'That PDF could not be imported.', true); });
    });

    function toggleSource() {
      if (!sourceMode) { src.value = clean(area.innerHTML); src.removeAttribute('hidden'); area.setAttribute('hidden', 'hidden'); sourceMode = true; }
      else { applySource(); }
      var b = bar.querySelector('[data-cmd=source]'); if (b) b.setAttribute('aria-pressed', sourceMode ? 'true' : 'false');
    }
    function applySource() { area.innerHTML = clean(src.value) || '<p><br></p>'; src.setAttribute('hidden', 'hidden'); area.removeAttribute('hidden'); sourceMode = false; }

    var CMDS = [
      ['block', 'Paragraph style'], '|',
      ['bold', 'Bold (Ctrl+B)', 'B'], ['italic', 'Italic (Ctrl+I)', 'I'], ['underline', 'Underline (Ctrl+U)', 'U'], ['strikeThrough', 'Strikethrough', 'S'], '|',
      ['insertUnorderedList', 'Bulleted list', '• List'], ['insertOrderedList', 'Numbered list', '1. List'], ['quote', 'Quote', '❝'], '|',
      ['link', 'Link (Ctrl+K)', 'Link'], ['image', 'Picture', 'Picture'], ['video', 'Video (YouTube, Vimeo or Loom)', 'Video'], ['callout', 'Call-out box', 'Call-out'], ['code', 'Code block', '{ }'], ['table', 'Table', 'Table'], ['rule', 'Horizontal line', '—'], '|',
      ['clear', 'Clear formatting', 'Clear'], ['undo', 'Undo', '↶'], ['redo', 'Redo', '↷']
    ];
    var blockSel = el('select', { 'aria-label': 'Paragraph style', 'data-cmd': 'block' });
    [['p', 'Paragraph'], ['h2', 'Heading'], ['h3', 'Subheading'], ['h4', 'Small heading']].forEach(function (o) { blockSel.appendChild(el('option', { value: o[0] }, o[1])); });
    blockSel.addEventListener('change', function () { exec('formatBlock', blockSel.value === 'p' ? 'p' : blockSel.value); });
    var calloutSel = null;
    function run(cmd) {
      if (cmd === 'link') { remember(); return ask('Link address', 'https://…', function (v) { if (!/^(https?:|mailto:)/i.test(v)) v = 'https://' + v; restore(); exec('createLink', v); }); }
      if (cmd === 'image') { remember(); return fileIn.click(); }
      if (cmd === 'video') { remember(); return ask('Video link', 'Paste a YouTube, Vimeo or Loom link', function (v) { var e = embedUrl(v); if (!e) return say('That is not a YouTube, Vimeo or Loom link. Copy the address from the video page.', true); restore(); insertHtml('<div class="video"><iframe src="' + e + '" title="Video"></iframe></div><p><br></p>'); }); }
      if (cmd === 'callout') { remember(); return ask('Call-out type: info, tip, warning or danger', 'info', function (v) { var k = /^(info|tip|warning|danger)$/i.test(v) ? v.toLowerCase() : 'info'; restore(); insertHtml('<div class="callout ' + k + '"><p>Write your note here.</p></div><p><br></p>'); }, 'info'); }
      if (cmd === 'quote') return exec('formatBlock', 'blockquote');
      if (cmd === 'code') return insertHtml('<pre>code</pre><p><br></p>');
      if (cmd === 'rule') return exec('insertHorizontalRule');
      if (cmd === 'table') return insertHtml('<table><thead><tr><th>Heading</th><th>Heading</th><th>Heading</th></tr></thead><tbody><tr><td>Text</td><td>Text</td><td>Text</td></tr><tr><td>Text</td><td>Text</td><td>Text</td></tr></tbody></table><p><br></p>');
      if (cmd === 'clear') { exec('removeFormat'); return exec('formatBlock', 'p'); }
      if (cmd === 'source') return toggleSource();
      if (cmd === 'pdf') return pdfIn.click();
      exec(cmd);
    }
    CMDS.forEach(function (c) {
      if (c === '|') return bar.appendChild(el('span', { class: 'ed-sep', 'aria-hidden': 'true' }));
      if (c[0] === 'block') return bar.appendChild(blockSel);
      var b = el('button', { type: 'button', class: 'ed-btn', title: c[1], 'aria-label': c[1], 'data-cmd': c[0], onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () { run(c[0]); } }, c[2]);
      bar.appendChild(b);
    });
    bar.appendChild(el('span', { class: 'ed-sep', 'aria-hidden': 'true' }));
    if (opts.canSource) bar.appendChild(el('button', { type: 'button', class: 'ed-btn', title: 'Edit the HTML', 'aria-label': 'Edit the HTML', 'aria-pressed': 'false', 'data-cmd': 'source', onclick: function () { run('source'); } }, 'HTML'));
    bar.appendChild(el('button', { type: 'button', class: 'ed-btn' + (opts.canImport ? '' : ' locked'), title: opts.canImport ? 'Turn a PDF into an article' : 'Importing a PDF is part of the Team plan', 'aria-label': 'Import a PDF', 'data-cmd': 'pdf', onclick: function () { if (!opts.canImport) return say('Importing a PDF is part of the Team plan. Upgrade to use it.', true); run('pdf'); } }, opts.canImport ? 'Import PDF' : 'Import PDF (Team)'));
    area.addEventListener('keydown', function (ev) {
      var mod = ev.ctrlKey || ev.metaKey; if (!mod) return;
      var k = String(ev.key).toLowerCase(); if (k === 'k') { ev.preventDefault(); run('link'); }
    });
    [bar, dlg, imgBar, area, src, fileIn, pdfIn].forEach(function (x) { wrap.appendChild(x); });
    setHtml(opts.html || '');
    return { el: wrap, getHtml: getHtml, setHtml: setHtml, clean: clean, embedUrl: embedUrl, area: area };
  }
  root.EffArticleEditor = { create: create, embedUrl: embedUrl };
})(typeof window !== 'undefined' ? window : this);
