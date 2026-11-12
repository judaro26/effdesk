// public/js/article-editor.js: THE HELP ARTICLE EDITOR. What you see is what customers get: headings, bold, italic, lists, quotes, links, code, tables, call-out boxes, pictures (uploaded, dragged in or pasted), video (YouTube, Vimeo, Loom) and, on paid plans, HTML source and PDF import.
//   EffArticleEditor.create(doc, { html, canSource, canImport, upload(file) -> Promise<url>, importPdf(file) -> Promise<{ html, title }>, say(text, bad) }) -> { el, getHtml(), setHtml(html), clean(html) }
//   Everything that enters the editor (stored text, pasted HTML, the source box, an import) passes through clean(): an inert parse with an allow-list, so nothing runs. The server cleans again before saving and before showing.
(function (root) {
  'use strict';
  var TAGS = 'h2 h3 h4 p br hr strong b em i u s del sub sup code pre blockquote ul ol li a img figure figcaption table thead tbody tr th td div span iframe video details summary mark kbd caption colgroup col center small'.split(' ');
  var ATTRS = { a: ['href', 'title'], img: ['src', 'alt', 'width', 'height'], iframe: ['src', 'title'], video: ['src', 'controls'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'], col: ['span'], colgroup: ['span'] };
  var CLASSES = ['callout', 'info', 'tip', 'warning', 'danger', 'video', 'img-s', 'img-m', 'img-l', 'img-left', 'img-right', 'img-round', 'img-shadow', 'img-border', 'img-zoom', 'center', 'right', 'lead', 'steps', 'btn', 'tbl-striped', 'tbl-plain'];
  // the formatting a writer may apply (mirrors src/html-clean.js: every value must match a strict pattern)
  var FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino Linotype', 'Garamond', 'Courier New', 'Lucida Console', 'Impact'];
  var FN = FONTS.join('|').replace(/ /g, '\\s'), FONT_RE = new RegExp('^(?:"?(?:' + FN + ')"?)(?:\\s*,\\s*(?:"?(?:' + FN + ')"?|serif|sans-serif|monospace|cursive))*$', 'i');
  var COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i, /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i, /^(?:black|white|red|green|blue|orange|yellow|purple|gray|grey|navy|teal|maroon|olive|silver|lime|aqua|fuchsia|transparent)$/i];
  var PX = /^(?:0|(?:[1-9]\d?|1\d\d|2[0-3]\d|240)(?:\.\d)?px)$/, WIDTH = /^(?:(?:100|[1-9]?\d)(?:\.\d{1,2})?%|(?:[1-9]\d{0,3})px)$/;
  var STYLES = {
    'color': COLOR, 'background-color': COLOR, 'text-align': [/^(?:left|right|center|justify)$/i],
    'font-size': [/^(?:(?:[6-9]|[1-8]\d|9[0-6])(?:\.\d{1,2})?(?:px|pt)|(?:0?\.[5-9]\d?|[1-5](?:\.\d{1,2})?|6)(?:em|rem)|(?:5\d|[6-9]\d|[1-3]\d\d|400)%)$/i],
    'font-family': [FONT_RE], 'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i], 'font-style': [/^(?:normal|italic)$/i],
    'text-decoration': [/^(?:none|underline|line-through|underline line-through|line-through underline)$/i],
    'line-height': [/^(?:[1-3](?:\.\d{1,2})?|(?:1[0-9]\d|2\d\d|300)%)$/], 'letter-spacing': [/^-?(?:[0-5](?:\.\d)?)px$/],
    'margin-left': [PX], 'margin-right': [PX], 'padding-left': [PX], 'text-indent': [PX], 'width': [WIDTH], 'vertical-align': [/^(?:top|middle|bottom|baseline)$/i],
    'border': [/^[0-4]px (?:solid|dashed|dotted) (?:#[0-9a-f]{3,8}|rgba?\([\d\s,.]{5,24}\))$/i], 'border-collapse': [/^collapse$/i]
  };
  var FONT_SIZES = { 1: '10px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' };
  var EMAIL_STYLES = {
    'background': [/^(?:#[0-9a-f]{3,8}|[a-z]+)$/i], 'background-color': COLOR, 'color': COLOR,
    'text-align': [/^(left|right|center|justify)$/], 'vertical-align': [/^(top|middle|bottom|baseline)$/], 'font-weight': [/^(bold|normal|[1-9]00)$/],
    'font-size': [/^[0-9.]+(px|pt|em|rem|%)$/], 'font-family': [/^[a-zA-Z0-9 ,"'_-]+$/], 'line-height': [/^[0-9.]+(px|pt|em|rem|%)?$/],
    'letter-spacing': [/^-?[0-9.]+(px|pt|em|rem)$/], 'text-transform': [/^(none|uppercase|lowercase|capitalize)$/], 'text-decoration': [/^(none|underline|line-through)$/],
    'white-space': [/^(normal|nowrap|pre|pre-wrap|pre-line)$/], 'word-break': [/^(normal|break-all|keep-all|break-word)$/], 'overflow-wrap': [/^(normal|break-word|anywhere)$/],
    'display': [/^(block|inline|inline-block|table|table-row|table-cell)$/], 'box-sizing': [/^(border-box|content-box)$/], 'border-collapse': [/^(collapse|separate)$/],
    'border-spacing': [/^[0-9.]+(px|pt|em|rem)(\s+[0-9.]+(px|pt|em|rem))?$/],
    'padding': [/^[0-9.]+(px|pt|em|rem|%)?(\s+[0-9.]+(px|pt|em|rem|%)?){0,3}$/],
    'padding-top': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-right': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-bottom': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-left': [/^[0-9.]+(px|pt|em|rem|%)$/],
    'margin': [/^[0-9.]+(px|pt|em|rem|%)?(\s+[0-9.]+(px|pt|em|rem|%)?){0,3}$/],
    'margin-top': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-right': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-bottom': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-left': [/^[0-9.]+(px|pt|em|rem|%)$/],
    'width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'max-width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'min-width': [/^[0-9.]+(px|pt|em|rem|%)$/],
    'height': [/^[0-9.]+(px|pt|em|rem|%)$/], 'max-height': [/^[0-9.]+(px|pt|em|rem|%)$/], 'min-height': [/^[0-9.]+(px|pt|em|rem|%)$/],
    'border': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
    'border-top': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i], 'border-right': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
    'border-bottom': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i], 'border-left': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
    'border-radius': [/^[0-9.]+(px|pt|em|rem|%)$/], 'float': [/^(left|right|none)$/], 'clear': [/^(both|left|right|none)$/],
    'list-style-type': [/^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/]
  };
  function cleanStyle(text, emailMode) {
    var out = []; String(text || '').split(';').forEach(function (d) {
      var i = d.indexOf(':'); if (i < 0) return; var k = d.slice(0, i).trim().toLowerCase(), v = d.slice(i + 1).trim().replace(/\s*!important$/i, '');
      var rules = emailMode ? (EMAIL_STYLES[k] || STYLES[k]) : STYLES[k]; if (rules && rules.some(function (re) { return re.test(v); })) out.push(k + ':' + v);
    }); return out.join(';');
  }
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
          var styleText = n.getAttribute('style') || '';
          if (tag === 'font') { var fs = []; if (n.getAttribute('color')) fs.push('color:' + n.getAttribute('color')); if (n.getAttribute('face')) fs.push('font-family:' + String(n.getAttribute('face')).replace(/[;"<>]/g, '')); if (FONT_SIZES[n.getAttribute('size')]) fs.push('font-size:' + FONT_SIZES[n.getAttribute('size')]); styleText = fs.join(';'); tag = 'span'; }
          if (DROP_WITH_CONTENT.indexOf(tag) >= 0) continue;
          if (TAGS.indexOf(tag) < 0) { walk(n, to); continue; }                        // unknown tag: keep its text
          if (tag === 'iframe') { var s = n.getAttribute('src') || '', ok = false; try { var uu = new URL(s); ok = uu.protocol === 'https:' && VIDEO_HOSTS.indexOf(uu.hostname) >= 0 && (uu.pathname.indexOf('/embed/') === 0 || uu.hostname === 'player.vimeo.com'); } catch (e) { } if (!ok) continue; }
          if (tag === 'img' && !okImg(n.getAttribute('src'))) continue;
          if (tag === 'video' && !/^https:\/\//i.test(n.getAttribute('src') || '')) continue;
          if (tag === 'a' && !okHref(n.getAttribute('href'))) { walk(n, to); continue; }
          var c = doc.createElement(tag);
          (ATTRS[tag] || []).forEach(function (a) { var v = n.getAttribute(a); if (v == null) return; if ((a === 'width' || a === 'height') && !/^\d{1,4}$/.test(v)) return; c.setAttribute(a, v); });
          var st = cleanStyle(styleText, opts.emailMode); if (st) c.setAttribute('style', st);
          if (opts.emailMode) { ['align','valign','width','height','bgcolor','cellpadding','cellspacing','border'].forEach(function (a) { var v = n.getAttribute(a); if (v == null) return; if ((a === 'width' || a === 'height') && !/^\d{1,4}(%?)$/.test(v)) return; if (a === 'bgcolor' && !/^(#[0-9a-f]{3,8}|[a-z]+)$/i.test(v)) return; if (a === 'align' && !/^(left|right|center)$/i.test(v)) return; if (a === 'valign' && !/^(top|middle|bottom)$/i.test(v)) return; if (/^(cellpadding|cellspacing|border)$/.test(a) && !/^\d{1,3}$/.test(v)) return; c.setAttribute(a, v); }); }
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
    function setHtml(h) { area.innerHTML = clean(h) || '<p><br></p>'; if (typeof countWords === 'function') countWords(); }
    function getHtml() { if (sourceMode) applySource(); var h = clean(area.innerHTML); return /^(<p>(<br>)?<\/p>)?$/.test(h.trim()) ? '' : h; }
    try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
    function focusEnd() { area.focus(); }
    function exec(cmd, val) { area.focus(); try { var ok = doc.execCommand(cmd, false, val); if (cmd === 'hiliteColor' && !ok) doc.execCommand('backColor', false, val); } catch (e) { } }
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
      var group = function (label) { var g = el('span', { class: 'ae-grp' }); g.appendChild(el('span', { class: 'm' }, label)); imgBar.appendChild(g); return g; };
      var one = function (g, label, attr, classes, cls) { g.appendChild(el('button', (function () { var o = { type: 'button', class: 'btn l sm', onclick: function () { classes.forEach(function (c) { picked.classList.remove(c); }); if (cls) picked.classList.add(cls); mark(); } }; o['data-img-' + attr] = cls || 'none'; return o; })(), label)); };
      var tog = function (g, label, cls) { g.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-img-effect': cls, onclick: function () { picked.classList.toggle(cls); mark(); } }, label)); };
      var mark = function () { [].forEach.call(imgBar.querySelectorAll('[data-img-size],[data-img-align],[data-img-effect]'), function (b) { var v = b.getAttribute('data-img-size') || b.getAttribute('data-img-align') || b.getAttribute('data-img-effect'); b.setAttribute('aria-pressed', picked && v !== 'none' && picked.classList.contains(v) ? 'true' : 'false'); }); };
      imgBar.appendChild(alt);
      var gs = group('Size'); var SZ = ['img-s', 'img-m', 'img-l']; one(gs, 'Small', 'size', SZ, 'img-s'); one(gs, 'Medium', 'size', SZ, 'img-m'); one(gs, 'Large', 'size', SZ, 'img-l'); one(gs, 'Full', 'size', SZ, null);
      var ga = group('Place'); var AL = ['img-left', 'img-right', 'center']; one(ga, 'Left', 'align', AL, 'img-left'); one(ga, 'Centre', 'align', AL, 'center'); one(ga, 'Right', 'align', AL, 'img-right'); one(ga, 'In line', 'align', AL, null);
      var ge = group('Look'); tog(ge, 'Rounded', 'img-round'); tog(ge, 'Shadow', 'img-shadow'); tog(ge, 'Border', 'img-border'); tog(ge, 'Zoom on hover', 'img-zoom');
      imgBar.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-img-caption': '1', onclick: function () {
        var f = picked.closest('figure'); if (!f) { f = doc.createElement('figure'); picked.parentNode.insertBefore(f, picked); f.appendChild(picked); }
        var cap = f.querySelector('figcaption'); if (cap) cap.remove(); else { cap = doc.createElement('figcaption'); cap.textContent = 'Caption'; f.appendChild(cap); }
      } }, 'Caption'));
      imgBar.appendChild(el('button', { type: 'button', class: 'btn l sm', 'data-img-remove': '1', onclick: function () { var f = picked.closest('figure'); (f || picked).remove(); picked = null; imgBar.setAttribute('hidden', 'hidden'); } }, 'Remove'));
      mark();
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

    // ---- the ribbon: two rows, like a word processor
    var row1 = el('div', { class: 'ae-row' }), row2 = el('div', { class: 'ae-row' }), tblRow = el('div', { class: 'ae-row ae-tools', hidden: 'hidden', 'data-table-tools': '1' });
    bar.appendChild(row1); bar.appendChild(row2); bar.appendChild(tblRow);
    var sep = function (to) { to.appendChild(el('span', { class: 'ed-sep', 'aria-hidden': 'true' })); };
    var button = function (to, cmd, title, label, extra) { var b = el('button', { type: 'button', class: 'ed-btn' + (extra ? ' ' + extra : ''), title: title, 'aria-label': title, 'data-cmd': cmd, onmousedown: function (ev) { ev.preventDefault(); }, onclick: function () { run(cmd); } }, label); to.appendChild(b); return b; };
    var select = function (to, cmd, label, options, onPick) {
      var sel = el('select', { 'aria-label': label, 'data-cmd': cmd, title: label }); sel.appendChild(el('option', { value: '' }, label));
      options.forEach(function (o) { var op = el('option', { value: o[0] }, o[1]); if (o[2]) op.setAttribute('style', o[2]); sel.appendChild(op); });
      sel.addEventListener('change', function () { var v = sel.value; sel.value = ''; if (v) { restore(); onPick(v); } });
      sel.addEventListener('mousedown', remember); to.appendChild(sel); return sel;
    };
    var colour = function (to, cmd, title, label, initial) {
      var wrapC = el('label', { class: 'ae-colour', title: title }); wrapC.appendChild(el('span', {}, label));
      var inp = el('input', { type: 'color', 'aria-label': title, 'data-cmd': cmd, value: initial }); inp.addEventListener('mousedown', remember);
      inp.addEventListener('input', function () { restore(); exec(cmd, inp.value); }); wrapC.appendChild(inp); to.appendChild(wrapC);
    };
    // word processors paste and produce <font size> and <font face>: turn those into styled spans that the page can keep
    function fixFonts() {
      [].slice.call(area.querySelectorAll('font')).forEach(function (f) {
        var sp = doc.createElement('span'), st = [];
        if (f.getAttribute('size') && FONT_SIZES[f.getAttribute('size')]) st.push('font-size:' + (f.getAttribute('data-px') || FONT_SIZES[f.getAttribute('size')]));
        if (f.getAttribute('face')) st.push('font-family:' + f.getAttribute('face')); if (f.getAttribute('color')) st.push('color:' + f.getAttribute('color'));
        if (st.length) sp.setAttribute('style', st.join(';')); while (f.firstChild) sp.appendChild(f.firstChild); f.parentNode.replaceChild(sp, f);
      });
    }
    function setSize(px) { exec('fontSize', '7'); [].forEach.call(area.querySelectorAll('font[size="7"]'), function (f) { f.setAttribute('data-px', px + 'px'); }); fixFonts(); }
    function blockOfSelection() { var s = win.getSelection && win.getSelection(), n = s && s.anchorNode; while (n && n.parentNode !== area) n = n.parentNode; return n && n.nodeType === 1 ? n : null; }
    function cellOfSelection() { var s = win.getSelection && win.getSelection(), n = s && s.anchorNode; while (n && n !== area) { if (n.nodeName === 'TD' || n.nodeName === 'TH') return n; n = n.parentNode; } return null; }
    function tableTool(what) {
      var cell = cellOfSelection(); if (!cell) return say('Click inside a table cell first.', true);
      var row = cell.parentNode, table = row.closest('table'), idx = [].indexOf.call(row.children, cell), rows = [].slice.call(table.querySelectorAll('tr'));
      var blank = function (tag) { var c = doc.createElement(tag); c.innerHTML = '<br>'; return c; };
      if (what === 'row+') { var nr = doc.createElement('tr'); [].forEach.call(row.children, function () { nr.appendChild(blank('td')); }); row.parentNode.insertBefore(nr, row.nextSibling); if (row.parentNode.nodeName === 'THEAD') { var tb = table.querySelector('tbody') || table.appendChild(doc.createElement('tbody')); tb.insertBefore(nr, tb.firstChild); } }
      if (what === 'row-') { if (rows.length > 1) row.remove(); else table.remove(); }
      if (what === 'col+') rows.forEach(function (r) { var c = blank(r.children[idx] && r.children[idx].nodeName === 'TH' ? 'th' : 'td'); r.insertBefore(c, r.children[idx + 1] || null); });
      if (what === 'col-') { if (row.children.length > 1) rows.forEach(function (r) { if (r.children[idx]) r.children[idx].remove(); }); else table.remove(); }
      if (what === 'del') table.remove();
      if (what === 'striped') table.classList.toggle('tbl-striped');
      if (what === 'plain') table.classList.toggle('tbl-plain');
      if (what === 'shade') { cell.style.backgroundColor = cell.style.backgroundColor ? '' : '#eef2f7'; }
      updateTools();
    }
    function updateTools() { var c = cellOfSelection(); if (c) tblRow.removeAttribute('hidden'); else tblRow.setAttribute('hidden', 'hidden'); }
    function countWords() { var t = (area.textContent || '').trim(); words.textContent = (t ? t.split(/\s+/).length : 0) + ' words'; }
    function insertTable() {
      remember(); ask('Table size: columns x rows', '3 x 3', function (v) {
        var m = String(v).match(/(\d{1,2})\D+(\d{1,2})/), cols = Math.min(10, Math.max(1, m ? +m[1] : 3)), rws = Math.min(30, Math.max(1, m ? +m[2] : 3)), h = '<table style="width:100%"><thead><tr>', r, c;
        for (c = 0; c < cols; c++) h += '<th>Heading</th>'; h += '</tr></thead><tbody>';
        for (r = 1; r < rws; r++) { h += '<tr>'; for (c = 0; c < cols; c++) h += '<td>Text</td>'; h += '</tr>'; } restore(); insertHtml(h + '</tbody></table><p><br></p>');
      }, '3 x 3');
    }
    var calloutSel = null;
    function run(cmd) {
      if (cmd === 'link') { remember(); return ask('Link address', 'https://…', function (v) { if (!/^(https?:|mailto:)/i.test(v)) v = 'https://' + v; restore(); exec('createLink', v); }); }
      if (cmd === 'image') { remember(); return fileIn.click(); }
      if (cmd === 'video') { remember(); return ask('Video link', 'Paste a YouTube, Vimeo or Loom link', function (v) { var e = embedUrl(v); if (!e) return say('That is not a YouTube, Vimeo or Loom link. Copy the address from the video page.', true); restore(); insertHtml('<div class="video"><iframe src="' + e + '" title="Video"></iframe></div><p><br></p>'); }); }
      if (cmd === 'callout') { remember(); return ask('Call-out type: info, tip, warning or danger', 'info', function (v) { var k = /^(info|tip|warning|danger)$/i.test(v) ? v.toLowerCase() : 'info'; restore(); insertHtml('<div class="callout ' + k + '"><p>Write your note here.</p></div><p><br></p>'); }, 'info'); }
      if (cmd === 'quote') return exec('formatBlock', 'blockquote');
      if (cmd === 'code') return insertHtml('<pre>code</pre><p><br></p>');
      if (cmd === 'rule') return exec('insertHorizontalRule');
      if (cmd === 'table') return insertTable();
      if (cmd === 'clear') { exec('removeFormat'); return exec('formatBlock', 'p'); }
      if (cmd === 'source') return toggleSource();
      if (cmd === 'pdf') return pdfIn.click();
      if (cmd.indexOf('table-') === 0) return tableTool(cmd.slice(6));
      exec(cmd);
    }
    var blockSel = el('select', { 'aria-label': 'Paragraph style', 'data-cmd': 'block', title: 'Paragraph style' });
    [['p', 'Paragraph'], ['h2', 'Heading'], ['h3', 'Subheading'], ['h4', 'Small heading']].forEach(function (o) { blockSel.appendChild(el('option', { value: o[0] }, o[1])); });
    blockSel.addEventListener('change', function () { exec('formatBlock', blockSel.value === 'p' ? 'p' : blockSel.value); });
    blockSel.addEventListener('mousedown', remember);
    row1.appendChild(blockSel);
    select(row1, 'fontName', 'Font', FONTS.map(function (f) { return [f, f, 'font-family:' + f]; }), function (v) { exec('fontName', v); });
    select(row1, 'fontSize', 'Size', [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48].map(function (n) { return [String(n), n + ' px']; }), function (v) { setSize(Number(v)); });
    sep(row1);
    button(row1, 'bold', 'Bold (Ctrl+B)', 'B', 'ed-b'); button(row1, 'italic', 'Italic (Ctrl+I)', 'I', 'ed-i'); button(row1, 'underline', 'Underline (Ctrl+U)', 'U', 'ed-u'); button(row1, 'strikeThrough', 'Strikethrough', 'S', 'ed-s');
    button(row1, 'subscript', 'Subscript', 'x₂'); button(row1, 'superscript', 'Superscript', 'x²');
    sep(row1); colour(row1, 'foreColor', 'Text colour', 'A', '#1f2933'); colour(row1, 'hiliteColor', 'Highlight', '■', '#fff3a3');
    sep(row1); button(row1, 'clear', 'Clear formatting', 'Clear'); button(row1, 'undo', 'Undo', '↶'); button(row1, 'redo', 'Redo', '↷');
    button(row2, 'justifyLeft', 'Align left', '≡ L'); button(row2, 'justifyCenter', 'Centre', '≡ C'); button(row2, 'justifyRight', 'Align right', '≡ R'); button(row2, 'justifyFull', 'Justify', '≡ J');
    sep(row2); button(row2, 'insertUnorderedList', 'Bulleted list', '• List'); button(row2, 'insertOrderedList', 'Numbered list', '1. List'); button(row2, 'outdent', 'Decrease indent', '⇤'); button(row2, 'indent', 'Increase indent', '⇥');
    select(row2, 'lineHeight', 'Spacing', [['1', 'Single'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', 'Double']], function (v) { var b = blockOfSelection(); if (b) b.style.lineHeight = v; });
    button(row2, 'quote', 'Quote', '❝');
    sep(row2); button(row2, 'link', 'Link (Ctrl+K)', 'Link'); button(row2, 'image', 'Picture', 'Picture'); button(row2, 'video', 'Video (YouTube, Vimeo or Loom)', 'Video'); button(row2, 'callout', 'Call-out box', 'Call-out'); button(row2, 'code', 'Code block', '{ }'); button(row2, 'table', 'Table', 'Table'); button(row2, 'rule', 'Horizontal line', '—');
    sep(row2);
    if (opts.canSource) row2.appendChild(el('button', { type: 'button', class: 'ed-btn', title: 'Edit the HTML', 'aria-label': 'Edit the HTML', 'aria-pressed': 'false', 'data-cmd': 'source', onclick: function () { run('source'); } }, 'HTML'));
    if (!opts.hideImport) row2.appendChild(el('button', { type: 'button', class: 'ed-btn' + (opts.canImport ? '' : ' locked'), title: opts.canImport ? 'Turn a PDF into an article' : 'Importing a PDF is part of the Team plan', 'aria-label': 'Import a PDF', 'data-cmd': 'pdf', onclick: function () { if (!opts.canImport) return say('Importing a PDF is part of the Team plan. Upgrade to use it.', true); run('pdf'); } }, opts.canImport ? 'Import PDF' : 'Import PDF (Team)'));
    var words = el('span', { class: 'ae-words m', 'aria-live': 'off' }, '0 words'); row2.appendChild(words);
    tblRow.appendChild(el('span', { class: 'm' }, 'Table'));
    [['table-row+', 'Add a row below', '+ Row'], ['table-row-', 'Delete this row', '− Row'], ['table-col+', 'Add a column to the right', '+ Column'], ['table-col-', 'Delete this column', '− Column'], ['table-shade', 'Shade this cell', 'Shade cell'], ['table-striped', 'Striped rows', 'Stripes'], ['table-plain', 'Remove borders', 'No borders'], ['table-del', 'Delete the table', 'Delete table']].forEach(function (t) { button(tblRow, t[0], t[1], t[2]); });
    ['keyup', 'mouseup', 'input'].forEach(function (e) { area.addEventListener(e, function () { updateTools(); countWords(); }); });
    area.addEventListener('focus', function () { try { doc.execCommand('styleWithCSS', false, true); } catch (e) { } });
    area.addEventListener('keydown', function (ev) {
      var mod = ev.ctrlKey || ev.metaKey; if (!mod) return;
      var k = String(ev.key).toLowerCase(); if (k === 'k') { ev.preventDefault(); run('link'); }
    });
    [bar, dlg, imgBar, area, src, fileIn, pdfIn].forEach(function (x) { wrap.appendChild(x); });
    setHtml(opts.html || ''); countWords();
    return { el: wrap, getHtml: getHtml, setHtml: setHtml, clean: clean, embedUrl: embedUrl, area: area };
  }
  root.EffArticleEditor = { create: create, embedUrl: embedUrl };
})(typeof window !== 'undefined' ? window : this);
