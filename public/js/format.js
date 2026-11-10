// public/js/format.js: HOW A MESSAGE IS STORED AND SHOWN. A message is saved as plain text with a few markers, so it works everywhere (the API, email, search). This one small file turns that text into things you can see, and back:
//   parse(text)        the blocks of a message (paragraphs, headings, quotes, lists, code, rules, tables)
//   inline(text)       the styles inside a line (bold, italic, underline, strike, code, links)
//   toDom(doc, text)   page elements for the desk and the editor (never HTML strings)
//   fromDom(element)   the editor's content back into the text
//   html(text)         safe HTML with inline styles, for emails and the customer portal (everything is escaped first)
//   plain(text)        readable plain text, for the text part of an email
// The markers: **bold** _italic_ ++underline++ ~~strike~~ `code` [text](https://link) # heading > quote - list 1. list ``` code block ``` --- rule; tables from a spreadsheet (tab separated) or written with | bars. A backslash before a marker shows it as typed.
(function (root) {
  'use strict';
  var RULE = /^\s*([-*_])(\s*\1){2,}\s*$/, FENCE = /^\s*```\s*([A-Za-z0-9+#_.-]{0,20})\s*$/, MDSEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
  var HEAD = /^\s{0,3}(#{1,3})\s+(.*?)\s*#*\s*$/, QUOTE = /^\s{0,3}>\s?(.*)$/, BUL = /^(\s*)[-*+]\s+(.*)$/, ORD = /^(\s*)\d{1,3}[.)]\s+(.*)$/, ESC = '\\*_`~+[]#>-|.';
  var trim = function (s) { return String(s).replace(/^\s+|\s+$/g, ''); };
  function tabRow(line) { var c = line.split('\t').map(trim); while (c.length && !c[c.length - 1]) c.pop(); return c; }
  function barRow(line) { var s = trim(line).replace(/^\|/, '').replace(/\|$/, ''); return s.split('|').map(trim); }
  function table(rows) {
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }).concat([1])), head = 0;
    for (var i = 0; i < Math.min(rows.length, 5); i++) if (rows[i].length > 1) { head = i + 1; break; }          // title lines above the real header stay in the header
    if (!head) head = 1;
    return { t: 'table', width: width, head: rows.slice(0, head), body: rows.slice(head) };
  }
  function parse(text) {
    var lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n'), out = [], para = [], i = 0;
    var flush = function () { if (para.length) { out.push({ t: 'p', text: para.join('\n') }); para = []; } };
    while (i < lines.length) {
      var ln = lines[i], m;
      if ((m = FENCE.exec(ln))) { flush(); var code = []; i++; while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]); i++; out.push({ t: 'code', lang: m[1] || '', text: code.join('\n') }); continue; }
      if (RULE.test(ln)) { flush(); out.push({ t: 'hr' }); i++; continue; }
      if ((m = HEAD.exec(ln))) { flush(); out.push({ t: 'h', level: m[1].length, text: m[2] }); i++; continue; }
      if (QUOTE.test(ln)) { flush(); var q = []; while (i < lines.length && QUOTE.test(lines[i])) q.push(QUOTE.exec(lines[i++])[1]); out.push({ t: 'quote', blocks: parse(q.join('\n')) }); continue; }
      if (BUL.test(ln) || ORD.test(ln)) {
        flush(); var ordered = !BUL.test(ln), items = [];
        while (i < lines.length) {
          var lm = (ordered ? ORD : BUL).exec(lines[i]); if (!lm) { var other = (ordered ? BUL : ORD).exec(lines[i]); if (!(other && other[1].length >= 2 && items.length)) break; lm = other; }
          if (lm[1].length >= 2 && items.length) items[items.length - 1].sub.push(lm[2]); else items.push({ text: lm[2], sub: [] }); i++;
        }
        out.push({ t: 'list', ordered: ordered, items: items }); continue;
      }
      if (ln.indexOf('\t') >= 0 && lines[i + 1] !== undefined && lines[i + 1].indexOf('\t') >= 0) {
        flush(); var rows = []; while (i < lines.length && lines[i].indexOf('\t') >= 0) rows.push(tabRow(lines[i++])); out.push(table(rows)); continue;
      }
      if (ln.indexOf('|') >= 0 && lines[i + 1] !== undefined && MDSEP.test(lines[i + 1]) && lines[i + 1].indexOf('-') >= 0) {
        flush(); var hd = barRow(ln); i += 2; var bd = []; while (i < lines.length && lines[i].indexOf('|') >= 0 && trim(lines[i])) bd.push(barRow(lines[i++]));
        out.push({ t: 'table', width: Math.max.apply(null, [hd.length].concat(bd.map(function (r) { return r.length; }))), head: [hd], body: bd }); continue;
      }
      if (!trim(ln)) { flush(); i++; continue; }
      para.push(ln); i++;
    }
    flush(); return out;
  }
  // a marker pair such as ** ... ** starting at the front of s: the inner text and the length used, or null
  function pair(s, mark) {
    if (s.indexOf(mark) !== 0 || /\s/.test(s.charAt(mark.length) || ' ')) return null;
    var from = mark.length + 1;
    for (;;) { var end = s.indexOf(mark, from); if (end < 0) return null; if (!/\s/.test(s.charAt(end - 1)) && end > mark.length) return { inner: s.slice(mark.length, end), len: end + mark.length }; from = end + 1; }
  }
  // inline pieces, nested: {t:'text',v} {t:'code',v} {t:'a',href,c} {t:'b'|'i'|'u'|'s',c}
  function inline(text) {
    var s = String(text == null ? '' : text), out = [], buf = '', i = 0;
    var flush = function () { if (buf) { out.push({ t: 'text', v: buf }); buf = ''; } };
    while (i < s.length) {
      var c = s.charAt(i), rest = s.slice(i), m, p;
      if (c === '\\' && i + 1 < s.length && ESC.indexOf(s.charAt(i + 1)) >= 0) { buf += s.charAt(i + 1); i += 2; continue; }
      if (c === '`' && (m = /^`([^`\n]+)`/.exec(rest))) { flush(); out.push({ t: 'code', v: m[1] }); i += m[0].length; continue; }
      if (c === '[' && (m = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/.exec(rest))) { flush(); out.push({ t: 'a', href: m[2], c: inline(m[1]) }); i += m[0].length; continue; }
      if (c === '*' && (p = pair(rest, '**'))) { flush(); out.push({ t: 'b', c: inline(p.inner) }); i += p.len; continue; }
      if (c === '+' && (p = pair(rest, '++'))) { flush(); out.push({ t: 'u', c: inline(p.inner) }); i += p.len; continue; }
      if (c === '~' && (p = pair(rest, '~~'))) { flush(); out.push({ t: 's', c: inline(p.inner) }); i += p.len; continue; }
      if (c === '_' && (i === 0 || !/[A-Za-z0-9]/.test(s.charAt(i - 1))) && (p = pair(rest, '_')) && !/[A-Za-z0-9]/.test(s.charAt(i + p.len) || ' ')) { flush(); out.push({ t: 'i', c: inline(p.inner) }); i += p.len; continue; }
      if (c === 'h' && (i === 0 || /[\s(]/.test(s.charAt(i - 1))) && (m = /^https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"]/.exec(rest))) { flush(); out.push({ t: 'a', href: m[0], c: [{ t: 'text', v: m[0] }] }); i += m[0].length; continue; }
      buf += c; i++;
    }
    flush(); return out;
  }
  var textOf = function (nodes) { return nodes.map(function (n) { return n.t === 'text' || n.t === 'code' ? n.v : textOf(n.c || []); }).join(''); };
  // ---- page elements (the desk and the editor) ----
  var TAG = { b: 'strong', i: 'em', u: 'u', s: 's' };
  function inlineDom(doc, nodes, parent) {
    nodes.forEach(function (n) {
      if (n.t === 'text') { var parts = n.v.split('\n'); parts.forEach(function (x, k) { if (k) parent.appendChild(doc.createElement('br')); if (x) parent.appendChild(doc.createTextNode(x)); }); }
      else if (n.t === 'code') { var cd = doc.createElement('code'); cd.textContent = n.v; parent.appendChild(cd); }
      else if (n.t === 'a') { var a = doc.createElement('a'); a.setAttribute('href', n.href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer'); inlineDom(doc, n.c, a); parent.appendChild(a); }
      else { var e = doc.createElement(TAG[n.t]); inlineDom(doc, n.c, e); parent.appendChild(e); }
    });
  }
  function cellDom(doc, tag, r, i, width) { var c = doc.createElement(tag); if (r.length === 1 && width > 1) { c.setAttribute('colspan', String(width)); c.className = 'span'; } inlineDom(doc, inline(r[i] || ''), c); return c; }
  function rowDom(doc, r, width, th) { var tr = doc.createElement('tr'); if (r.length === 1 && width > 1) { tr.appendChild(cellDom(doc, th ? 'th' : 'td', r, 0, width)); return tr; } for (var i = 0; i < width; i++) tr.appendChild(cellDom(doc, th ? 'th' : 'td', r, i, width)); return tr; }
  function blocksDom(doc, blocks, parent) {
    blocks.forEach(function (b) {
      var e;
      if (b.t === 'hr') e = doc.createElement('hr');
      else if (b.t === 'code') { e = doc.createElement('pre'); var cd = doc.createElement('code'); cd.textContent = b.text; e.appendChild(cd); }
      else if (b.t === 'h') { e = doc.createElement('h' + (b.level + 1)); inlineDom(doc, inline(b.text), e); }
      else if (b.t === 'quote') { e = doc.createElement('blockquote'); blocksDom(doc, b.blocks, e); }
      else if (b.t === 'list') { e = doc.createElement(b.ordered ? 'ol' : 'ul'); b.items.forEach(function (it) { var li = doc.createElement('li'); inlineDom(doc, inline(it.text), li); if (it.sub.length) { var u = doc.createElement(b.ordered ? 'ol' : 'ul'); it.sub.forEach(function (x) { var l2 = doc.createElement('li'); inlineDom(doc, inline(x), l2); u.appendChild(l2); }); li.appendChild(u); } e.appendChild(li); }); }
      else if (b.t === 'table') { var w = doc.createElement('div'); w.className = 'tblwrap'; var t = doc.createElement('table'); t.className = 'mtable'; t.setAttribute('data-table', '1'); var th = doc.createElement('thead'), tb = doc.createElement('tbody'); b.head.forEach(function (r) { th.appendChild(rowDom(doc, r, b.width, true)); }); b.body.forEach(function (r) { tb.appendChild(rowDom(doc, r, b.width, false)); }); t.appendChild(th); t.appendChild(tb); w.appendChild(t); e = w; }
      else { e = doc.createElement('p'); inlineDom(doc, inline(b.text), e); }
      if (b.t === 'hr') e.setAttribute('data-rule', '1'); if (b.t === 'code') e.setAttribute('data-code', '1');
      parent.appendChild(e);
    });
  }
  function toDom(doc, text, into) { var box = into || doc.createElement('div'); blocksDom(doc, parse(text), box); return box; }
  // ---- the editor's content back into text ----
  var escText = function (s) { return String(s).replace(/ /g, ' ').replace(/([\\*`~\[])/g, '\\$1').replace(/\+\+/g, '\\+\\+').replace(/(^|[^A-Za-z0-9])_|_(?![A-Za-z0-9])/g, function (m) { return m.replace('_', '\\_'); }); };
  var guard = function (line) { return line.replace(/^(\s{0,3})(#{1,3}\s|>|[-+]\s|\d{1,3}[.)]\s|\|)/, function (m, sp, mk) { var k = 0; if (/^\d/.test(mk)) return sp + mk.replace(/([.)])/, '\\$1'); return sp + '\\' + mk; }).replace(/^(\s{0,3})(---+|___+)\s*$/, '$1\\$2').replace(/^(\s{0,3})(```)/, '$1\\`\\`\\`'); };
  var safeHref = function (h) { return /^(https?:\/\/[^\s)]+|mailto:[^\s)]+)$/i.test(String(h || '').trim()) ? String(h).trim() : ''; };
  var wrapWith = function (mark, inner) { var m = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner); return m[2] ? m[1] + mark + m[2] + mark + m[3] : inner; };
  function inlineText(node) {
    var s = '';
    [].slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { s += escText(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toUpperCase(), inner;
      if (tag === 'BR') { s += '\n'; return; }
      if (tag === 'IMG' || tag === 'SCRIPT' || tag === 'STYLE') return;
      if (tag === 'CODE') { var t = n.textContent.replace(/`/g, ''); s += t ? '`' + t + '`' : ''; return; }
      inner = inlineText(n);
      if (tag === 'B' || tag === 'STRONG') s += wrapWith('**', inner);
      else if (tag === 'I' || tag === 'EM') s += wrapWith('_', inner);
      else if (tag === 'U') s += wrapWith('++', inner);
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') s += wrapWith('~~', inner);
      else if (tag === 'A') { var h = safeHref(n.getAttribute('href')); s += h && inner.trim() ? '[' + inner.replace(/\]/g, '\\]') + '](' + h + ')' : inner; }
      else if (tag === 'SPAN' || tag === 'FONT') { var st = n.style || {}, w = String(st.fontWeight || ''), x = inner; if (w === 'bold' || Number(w) >= 600) x = wrapWith('**', x); if (st.fontStyle === 'italic') x = wrapWith('_', x); if (/underline/.test(st.textDecoration || st.textDecorationLine || '')) x = wrapWith('++', x); if (/line-through/.test(st.textDecoration || st.textDecorationLine || '')) x = wrapWith('~~', x); s += x; }
      else if (/^(DIV|P|H[1-6]|LI|BLOCKQUOTE|TR)$/.test(tag)) s += '\n' + inner + '\n'; else s += inner;
    });
    return s;
  }
  var BLOCK = /^(P|DIV|H[1-6]|BLOCKQUOTE|UL|OL|PRE|HR|TABLE|DL)$/;
  function listText(list, ordered, depth) {
    var n = 0, out = [];
    [].slice.call(list.children).forEach(function (li) {
      if (li.tagName.toUpperCase() !== 'LI') return; n++;
      var clone = li.cloneNode(true); [].slice.call(clone.querySelectorAll('ul,ol')).forEach(function (x) { x.parentNode.removeChild(x); });
      var line = trim(inlineText(clone)).replace(/\n+/g, ' '); out.push(new Array(depth * 2 + 1).join(' ') + (ordered ? n + '. ' : '- ') + line);
      [].slice.call(li.children).forEach(function (sub) { var tg = sub.tagName.toUpperCase(); if (tg === 'UL' || tg === 'OL') out.push(listText(sub, tg === 'OL', 1)); });
    });
    return out.join('\n');
  }
  function tableText(t) {
    var rows = [].slice.call(t.querySelectorAll('tr')).map(function (tr) { return [].slice.call(tr.children).map(function (c) { return trim(inlineText(c)).replace(/\n+/g, ' ').replace(/\|/g, '\\|'); }); });
    if (!rows.length) return ''; var w = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var line = function (r) { var c = r.slice(); while (c.length < w) c.push(''); return '| ' + c.join(' | ') + ' |'; };
    return [line(rows[0]), '|' + new Array(w + 1).join(' --- |')].concat(rows.slice(1).map(line)).join('\n');
  }
  function blocksText(node) {
    var out = [], loose = '';
    var flushLoose = function () { var t = trim(loose.replace(/\n{3,}/g, '\n\n')); if (t) t.split(/\n{2,}/).forEach(function (x) { out.push(guard(trim(x))); }); loose = ''; };
    [].slice.call(node.childNodes).forEach(function (n) {
      if (n.nodeType === 3) { loose += escText(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      var tag = n.tagName.toUpperCase();
      if (!BLOCK.test(tag)) { loose += inlineText({ childNodes: [n] }); return; }
      flushLoose();
      if (tag === 'HR') out.push('---');
      else if (tag === 'PRE') { var pc = n.cloneNode(true); [].slice.call(pc.querySelectorAll('br')).forEach(function (br) { br.parentNode.replaceChild(pc.ownerDocument.createTextNode('\n'), br); }); var code = pc.textContent.replace(/\u200b/g, '').replace(/\n$/, ''); out.push('```\n' + code + '\n```'); }
      else if (/^H[1-6]$/.test(tag)) { var lv = Math.min(3, Math.max(1, Number(tag.charAt(1)) - 1)); var ht = trim(inlineText(n)).replace(/\n+/g, ' '); if (ht) out.push(new Array(lv + 1).join('#') + ' ' + ht); }
      else if (tag === 'BLOCKQUOTE') { var inner = blocksText(n); if (inner) out.push(inner.split('\n').map(function (l) { return '> ' + l; }).join('\n')); }
      else if (tag === 'UL' || tag === 'OL') { var lt = listText(n, tag === 'OL', 0); if (lt) out.push(lt); }
      else if (tag === 'TABLE') { var tt = tableText(n); if (tt) out.push(tt); }
      else if ((tag === 'DIV' || tag === 'P') && [].slice.call(n.children).some(function (c) { return BLOCK.test(c.tagName.toUpperCase()); })) { var nested = blocksText(n); if (nested) out.push(nested); }
      else { var pt = trim(inlineText(n)); if (pt) out.push(guard(pt)); }
    });
    flushLoose(); return out.join('\n\n');
  }
  function fromDom(el) { return blocksText(el).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, ''); }
  // ---- emails and the portal: safe HTML with inline styles, and plain text ----
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var CELL = 'border:1px solid #d8dcde;padding:4px 8px;text-align:left;vertical-align:top';
  function inlineHtml(text) { return nodesHtml(inline(text)).replace(/\n/g, '<br>'); }
  function nodesHtml(nodes) {
    return nodes.map(function (n) {
      if (n.t === 'text') return esc(n.v);
      if (n.t === 'code') return '<code style="background:#f1f3f4;padding:1px 4px;border-radius:3px;font-family:Menlo,Consolas,monospace">' + esc(n.v) + '</code>';
      if (n.t === 'a') return '<a href="' + esc(n.href) + '" rel="noopener noreferrer">' + nodesHtml(n.c) + '</a>';
      var tg = TAG[n.t]; return '<' + tg + '>' + nodesHtml(n.c) + '</' + tg + '>';
    }).join('');
  }
  function rowHtml(r, width, th) {
    var tg = th ? 'th' : 'td';
    if (r.length === 1 && width > 1) return '<tr><' + tg + ' colspan="' + width + '" style="' + CELL + ';background:#f6f7f8;font-weight:' + (th ? '700' : '600') + '">' + inlineHtml(r[0]) + '</' + tg + '></tr>';
    var cells = ''; for (var i = 0; i < width; i++) cells += '<' + tg + ' style="' + CELL + (th ? ';background:#f1f3f4' : '') + '">' + inlineHtml(r[i] || '') + '</' + tg + '>'; return '<tr>' + cells + '</tr>';
  }
  function blocksHtml(blocks) {
    return blocks.map(function (b) {
      if (b.t === 'hr') return '<hr style="border:0;border-top:1px solid #d8dcde;margin:12px 0">';
      if (b.t === 'code') return '<pre style="background:#f1f3f4;border:1px solid #e1e4e6;border-radius:6px;padding:10px;overflow:auto;font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre">' + esc(b.text) + '</pre>';
      if (b.t === 'h') return '<h' + (b.level + 1) + ' style="margin:12px 0 6px">' + inlineHtml(b.text) + '</h' + (b.level + 1) + '>';
      if (b.t === 'quote') return '<blockquote style="margin:8px 0;padding:2px 12px;border-left:3px solid #c2c8cc;color:#49545c">' + blocksHtml(b.blocks) + '</blockquote>';
      if (b.t === 'list') { var tg = b.ordered ? 'ol' : 'ul'; return '<' + tg + ' style="margin:6px 0;padding-left:24px">' + b.items.map(function (it) { return '<li>' + inlineHtml(it.text) + (it.sub.length ? '<' + tg + '>' + it.sub.map(function (x) { return '<li>' + inlineHtml(x) + '</li>'; }).join('') + '</' + tg + '>' : '') + '</li>'; }).join('') + '</' + tg + '>'; }
      if (b.t === 'table') return '<div style="overflow:auto"><table style="border-collapse:collapse;font-size:14px;margin:8px 0"><thead>' + b.head.map(function (r) { return rowHtml(r, b.width, true); }).join('') + '</thead><tbody>' + b.body.map(function (r) { return rowHtml(r, b.width, false); }).join('') + '</tbody></table></div>';
      return '<div style="margin:0 0 8px">' + inlineHtml(b.text) + '</div>';
    }).join('');
  }
  function html(text) { return blocksHtml(parse(text)); }
  function plainInline(nodes) { return nodes.map(function (n) { if (n.t === 'text' || n.t === 'code') return n.v; var t = plainInline(n.c); return n.t === 'a' ? (t === n.href ? t : t + ' (' + n.href + ')') : t; }).join(''); }
  function plain(text) {
    return parse(text).map(function (b) {
      if (b.t === 'hr') return '----------';
      if (b.t === 'code') return b.text.split('\n').map(function (l) { return '    ' + l; }).join('\n');
      if (b.t === 'h') return plainInline(inline(b.text)).toUpperCase();
      if (b.t === 'quote') return plain(b.blocks.map(function (x) { return x.t === 'p' ? x.text : ''; }).join('\n\n')).split('\n').map(function (l) { return '> ' + l; }).join('\n');
      if (b.t === 'list') return b.items.map(function (it, k) { return (b.ordered ? (k + 1) + '. ' : '- ') + plainInline(inline(it.text)) + it.sub.map(function (x) { return '\n   - ' + plainInline(inline(x)); }).join(''); }).join('\n');
      if (b.t === 'table') return b.head.concat(b.body).map(function (r) { return r.map(function (c) { return plainInline(inline(c)); }).join('\t'); }).join('\n');
      return plainInline(inline(b.text));
    }).join('\n\n');
  }
  root.EffFormat = { parse: parse, inline: inline, toDom: toDom, fromDom: fromDom, html: html, plain: plain, textOf: textOf };
})(typeof globalThis !== 'undefined' ? globalThis : this);
