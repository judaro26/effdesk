// public/js/editor.js: THE MESSAGE EDITOR. A text box with a toolbar (bold, italic, underline, strike, headings, lists, quote, link, code, code block, line, table, clear, undo, redo) and typing shortcuts (--- then Enter makes a line, ``` then Enter a code block, "# ", "> ", "- ", "1. "). What you see is what is sent. The plain text box underneath stays the source of truth (message text with **bold** markers), so everything else (the API, email, search) keeps working. Without the formatter, or if the editor cannot start, the plain box stays.
//   EffEditor.enhance(doc, textarea, { onImages(files) })  -> the element to put on the page (it holds the textarea)
(function (root) {
  'use strict';
  var F = function () { return root.EffFormat; };
  var BUTTONS = [
    ['bold', 'Bold (Ctrl+B)', 'B', 'b'], ['italic', 'Italic (Ctrl+I)', 'I', 'i'], ['underline', 'Underline (Ctrl+U)', 'U', 'u'], ['strikeThrough', 'Strikethrough', 'S', 's'], '|',
    ['h', 'Heading'], '|',
    ['insertUnorderedList', 'Bulleted list', '• List'], ['insertOrderedList', 'Numbered list', '1. List'], ['quote', 'Quote', '❝'], '|',
    ['link', 'Link (Ctrl+K)', 'Link'], ['code', 'Inline code', '</>'], ['codeblock', 'Code block', '{ }'], ['rule', 'Horizontal line', '—'], ['table', 'Table', 'Table'], '|',
    ['clear', 'Clear formatting', 'Clear'], ['undo', 'Undo', '↶'], ['redo', 'Redo', '↷']
  ];
  function enhance(doc, ta, opts) {
    opts = opts || {};
    var win = doc.defaultView || root;
    if (!F() || !doc.createElement || ta.getAttribute('data-plain')) return ta;
    var el = function (tag, attrs) { var e = doc.createElement(tag); Object.keys(attrs || {}).forEach(function (k) { if (k === 'text') e.textContent = attrs[k]; else e.setAttribute(k, attrs[k]); }); return e; };
    var wrap = el('div', { class: 'ed' }), bar = el('div', { class: 'ed-bar', role: 'toolbar', 'aria-label': 'Formatting' });
    var area = el('div', { class: 'ed-area', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': ta.getAttribute('aria-label') || 'Message', 'data-editor': '1' });
    if (ta.getAttribute('placeholder')) area.setAttribute('data-placeholder', ta.getAttribute('placeholder'));
    ta.setAttribute('hidden', 'hidden'); ta.setAttribute('tabindex', '-1');
    F().toDom(doc, ta.value || '', area); seed(); try { doc.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { }
    var link = null;
    function sync() { if (!area.firstChild || (!area.textContent.replace(/\u200b/g, '') && !area.querySelector('hr,table,pre,li,img,h2,h3,h4,blockquote') && !(area.firstChild.nodeName === 'P' && area.childNodes.length === 1 && area.firstChild.childNodes.length === 1 && area.firstChild.firstChild.nodeName === 'BR'))) { clearArea(); seed(); place(area.firstChild); } var v = F().fromDom(area); ta.value = v; ta.dispatchEvent(new win.Event('input', { bubbles: true })); area.classList.toggle('empty', !v && !area.querySelector('hr,table,pre')); }
    function exec(cmd, val) { area.focus(); try { doc.execCommand(cmd, false, val); } catch (e) { } sync(); }
    // put elements at the cursor (replacing the selection); never builds HTML text
    function insertNodes(frag) {
      area.focus(); var s = win.getSelection(), r = s && s.rangeCount && area.contains(s.anchorNode) ? s.getRangeAt(0) : null;
      if (!r) { r = doc.createRange(); r.selectNodeContents(area); r.collapse(false); }
      r.deleteContents(); var last = frag.lastChild; r.insertNode(frag);
      if (last) { r.setStartAfter(last); r.collapse(true); s.removeAllRanges(); s.addRange(r); } sync();
    }
    function insertHtmlNode(node) { var f = doc.createDocumentFragment(); f.appendChild(node); insertNodes(f); }
    function clearArea() { while (area.firstChild) area.removeChild(area.firstChild); }
    function seed() { if (!area.firstChild) { var p = el('p'); p.appendChild(el('br')); area.appendChild(p); } }
    function curBlock() { var s = win.getSelection && win.getSelection(), n = s && s.anchorNode; while (n && n !== area) { if (n.nodeType === 1 && /^(P|DIV|H[1-6]|LI|PRE|BLOCKQUOTE)$/.test(n.tagName)) return n; n = n.parentNode; } return null; }
    // text typed straight into the box has no paragraph yet: make one so shortcuts and lists have a line to work on
    function lineBlock() { var b = curBlock(); if (b && b !== area) return b; try { doc.execCommand('formatBlock', false, 'p'); } catch (e) { } b = curBlock(); return b && b !== area ? b : null; }
    function inTag(re) { var s = win.getSelection && win.getSelection(), n = s && s.anchorNode; while (n && n !== area) { if (n.nodeType === 1 && re.test(n.tagName)) return n; n = n.parentNode; } return null; }
    function wrapSelection(tag) {
      var s = win.getSelection(); if (!s.rangeCount) return; var existing = inTag(new RegExp('^' + tag + '$', 'i'));
      if (existing) { var t = doc.createTextNode(existing.textContent); existing.parentNode.replaceChild(t, existing); sync(); return; }
      var r = s.getRangeAt(0), e = el(tag); if (r.collapsed) { e.appendChild(doc.createTextNode('​')); r.insertNode(e); r.selectNodeContents(e); s.removeAllRanges(); s.addRange(r); } else { e.appendChild(r.extractContents()); r.insertNode(e); }
      sync();
    }
    function insertTable() { var t = F().toDom(doc, '| Column 1 | Column 2 |\n| --- | --- |\n| | |\n| | |'); insertHtmlNode(t.firstChild); }
    function askLink() {
      if (link) { link.parentNode.removeChild(link); link = null; return; }
      var s = win.getSelection(), saved = s.rangeCount ? s.getRangeAt(0).cloneRange() : null, sel = saved ? saved.toString() : '';
      link = el('div', { class: 'ed-link' }); var url = el('input', { type: 'url', placeholder: 'https://…', 'aria-label': 'Link address' }), go = el('button', { type: 'button', class: 'btn sm', text: 'Add link' }), no = el('button', { type: 'button', class: 'btn l sm', text: 'Cancel' });
      var close = function () { if (link && link.parentNode) link.parentNode.removeChild(link); link = null; area.focus(); };
      var apply = function () { var u = url.value.trim(); if (u && !/^(https?:|mailto:)/i.test(u)) u = /@/.test(u) && !/\s/.test(u) ? 'mailto:' + u : 'https://' + u; if (!/^(https?:\/\/[^\s)]+|mailto:[^\s)]+)$/i.test(u)) { url.setAttribute('aria-invalid', 'true'); return; } close(); if (saved) { var sl = win.getSelection(); sl.removeAllRanges(); sl.addRange(saved); } if (sel) exec('createLink', u); else { var a = el('a', { href: u, text: u }); insertHtmlNode(a); } };
      go.addEventListener('click', apply); no.addEventListener('click', close); url.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(); } else if (e.key === 'Escape') close(); });
      link.appendChild(url); link.appendChild(go); link.appendChild(no); wrap.insertBefore(link, area); url.focus();
    }
    function block(tag) { exec('formatBlock', tag); }
    var heading = el('select', { 'aria-label': 'Text style', 'data-cmd': 'h' });
    [['p', 'Normal'], ['h2', 'Heading 1'], ['h3', 'Heading 2'], ['h4', 'Heading 3']].forEach(function (o) { var op = el('option', { value: o[0], text: o[1] }); heading.appendChild(op); });
    heading.addEventListener('change', function () { block(heading.value); });
    var act = {
      quote: function () { block(inTag(/^BLOCKQUOTE$/) ? 'p' : 'blockquote'); },
      link: askLink, code: function () { wrapSelection('code'); },
      codeblock: function () { if (inTag(/^PRE$/)) block('p'); else block('pre'); },
      rule: function () { exec('insertHorizontalRule'); }, table: insertTable,
      clear: function () { exec('removeFormat'); if (inTag(/^(H[1-6]|BLOCKQUOTE|PRE)$/)) block('p'); },
      undo: function () { exec('undo'); }, redo: function () { exec('redo'); }
    };
    BUTTONS.forEach(function (b) {
      if (b === '|') { bar.appendChild(el('span', { class: 'ed-sep', 'aria-hidden': 'true' })); return; }
      if (b[0] === 'h') { bar.appendChild(heading); return; }
      var btn = el('button', { type: 'button', class: 'ed-btn', 'data-cmd': b[0], title: b[1], 'aria-label': b[1].replace(/ \(.*\)/, ''), text: b[2] || b[0] });
      if (b[3]) btn.setAttribute('data-tag', b[3]);
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });          // keep the selection in the text
      btn.addEventListener('click', function () { if (act[b[0]]) act[b[0]](); else exec(b[0]); });
      bar.appendChild(btn);
    });
    // typing shortcuts
    area.addEventListener('keydown', function (e) {
      var k = String(e.key || '').toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) { if (k === 'k') { e.preventDefault(); askLink(); return; } if (k === 'u') { e.preventDefault(); exec('underline'); return; } }
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
      var sn0 = win.getSelection().anchorNode, cur0 = curBlock(), line0 = cur0 && cur0 !== area ? cur0.textContent : sn0 && sn0.parentNode === area ? sn0.nodeValue : '';
      if (!/^\s*(-{3,}|_{3,}|\*{3,}|```[A-Za-z0-9+#_.-]{0,20})\s*$/.test(String(line0))) return;
      var b = lineBlock(); if (!b || b.tagName === 'LI' || b.tagName === 'PRE') return;
      var txt = b.textContent.replace(/ |​/g, ' ').trim();
      if (/^(---+|___+|\*\*\*+)$/.test(txt) && b.tagName !== 'H2') { e.preventDefault(); var hr = el('hr'), p = el('p'); p.appendChild(el('br')); b.parentNode.replaceChild(hr, b); hr.parentNode.insertBefore(p, hr.nextSibling); place(p); sync(); return; }
      var fence = /^```\s*([A-Za-z0-9+#_.-]{0,20})$/.exec(txt);
      if (fence) { e.preventDefault(); var pre = el('pre'), cd = el('code'); cd.appendChild(doc.createTextNode('​')); pre.appendChild(cd); b.parentNode.replaceChild(pre, b); place(cd); sync(); return; }
    });
    area.addEventListener('keydown', function (e) {
      if (e.key !== ' ' || e.ctrlKey || e.metaKey) return;
      var b = lineBlock(); if (!b || b.tagName !== 'P' && b.tagName !== 'DIV') return;
      var m = /^(#{1,3}|>|-|\*|\+|1[.)])$/.exec(b.textContent.replace(/ /g, ' ')); if (!m) return;
      e.preventDefault(); var t = m[1], target;
      if (t.charAt(0) === '#') target = el('h' + (t.length + 1)); else if (t === '>') target = el('blockquote'); else target = el(/^1/.test(t) ? 'ol' : 'ul');
      var inner = target;
      if (target.tagName === 'UL' || target.tagName === 'OL') { inner = el('li'); target.appendChild(inner); } else if (target.tagName === 'BLOCKQUOTE') { inner = el('p'); target.appendChild(inner); }
      inner.appendChild(el('br')); b.parentNode.replaceChild(target, b); place(inner); sync();
    });
    function place(node) { var s = win.getSelection(), r = doc.createRange(); r.selectNodeContents(node); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    // a pasted picture is attached; pasted text and tables keep their structure but never bring in styles or scripts
    area.addEventListener('paste', function (e) {
      var cd = e.clipboardData; if (!cd) return;
      var files = [].slice.call(cd.items || []).filter(function (it) { return it.kind === 'file' && /^image\//.test(it.type); }).map(function (it) { return it.getAsFile(); }).filter(Boolean);
      if (files.length && opts.onImages) { e.preventDefault(); opts.onImages(files, e); return; }
      var h = cd.getData && cd.getData('text/html'), t = cd.getData && cd.getData('text/plain');
      e.preventDefault();
      var box = el('div');
      // cells copied from a spreadsheet or another page: when the html has no table but the plain text is tab separated, the tabs make the table
      var tabbed = t && t.split(/\r?\n/).filter(function (l) { return l.indexOf('\t') >= 0; }).length >= 2;
      if (tabbed && !/<table\b/i.test(h || '')) h = '';
      if (h && /<(table|b|strong|i|em|u|a|ul|ol|li|h[1-6]|pre|code|blockquote|p|div|br)\b/i.test(h)) {
        var parsed = new win.DOMParser().parseFromString(h, 'text/html'); F().toDom(doc, F().fromDom(parsed.body), box);
      } else F().toDom(doc, t || '', box);
      var frag = doc.createDocumentFragment(); while (box.firstChild) frag.appendChild(box.firstChild); insertNodes(frag);
    });
    // typing three backticks at the start of a line starts a code block
    area.addEventListener('input', function (e) {
      if (e.inputType !== 'insertText' || e.data !== '`') return;
      var b = lineBlock(); if (!b || b.tagName === 'LI' || b.tagName === 'PRE') return;
      if (b.textContent.replace(/ |​/g, ' ').trim() !== '```') return;
      var pre = el('pre'), cd = el('code'); cd.appendChild(doc.createTextNode('​')); pre.appendChild(cd); b.parentNode.replaceChild(pre, b); place(cd); sync();
    });
    area.addEventListener('input', sync);
    area.addEventListener('blur', sync);
    var upd = function () { var tags = {}; ['b', 'strong', 'i', 'em', 'u', 's', 'strike'].forEach(function (t) { tags[t] = !!inTag(new RegExp('^' + t + '$', 'i')); }); [].slice.call(bar.querySelectorAll('[data-tag]')).forEach(function (btn) { var t = btn.getAttribute('data-tag'); btn.setAttribute('aria-pressed', String(!!(tags[t] || (t === 'b' && tags.strong) || (t === 'i' && tags.em)))); }); var h = inTag(/^H[2-4]$/); heading.value = h ? h.tagName.toLowerCase() : 'p'; };
    doc.addEventListener && doc.addEventListener('selectionchange', function () { if (doc.activeElement === area) upd(); });
    wrap.appendChild(bar); wrap.appendChild(area); wrap.appendChild(ta);
    area.classList.toggle('empty', !ta.value);
    wrap._set = function (text) { ta.value = text; clearArea(); F().toDom(doc, text, area); seed(); area.classList.toggle('empty', !text); };
    wrap._area = area;
    return wrap;
  }
  root.EffEditor = { enhance: enhance };
})(typeof globalThis !== 'undefined' ? globalThis : this);
