// public/js/format.js: HOW A MESSAGE IS SHOWN. One small formatter shared by the desk (it builds page elements from parse()), the customer portal and the emails (they use html(), which escapes everything first).
// What it understands: ``` fenced code blocks, a line of --- (or *** ___) as a line, tables (copied from Excel, Google Sheets or a web page, which arrive tab-separated, or written with | bars), `inline code`, **bold** and links. Anything else stays plain text with its line breaks.
(function (root) {
  'use strict';
  var RULE = /^\s*([-*_])(\s*\1){2,}\s*$/, FENCE = /^\s*```\s*([A-Za-z0-9+#_.-]{0,20})\s*$/, MDSEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
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
  // inline pieces: `code`, **bold**, and web links (https or http only)
  function inline(text) {
    var out = [], re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(https?:\/\/[^\s<]*[^\s<.,;:!?)\]'"])/g, last = 0, m, s = String(text);
    while ((m = re.exec(s))) {
      if (m.index > last) out.push({ t: 'text', v: s.slice(last, m.index) });
      if (m[1]) out.push({ t: 'code', v: m[1].slice(1, -1) }); else if (m[2]) out.push({ t: 'b', v: m[2].slice(2, -2) }); else out.push({ t: 'a', v: m[3], href: m[3] });
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push({ t: 'text', v: s.slice(last) }); return out;
  }
  var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  var CELL = 'border:1px solid #d8dcde;padding:4px 8px;text-align:left;vertical-align:top';
  function inlineHtml(text) { return inline(text).map(function (p) { return p.t === 'code' ? '<code style="background:#f1f3f4;padding:1px 4px;border-radius:3px;font-family:Menlo,Consolas,monospace">' + esc(p.v) + '</code>' : p.t === 'b' ? '<strong>' + esc(p.v) + '</strong>' : p.t === 'a' ? '<a href="' + esc(p.href) + '" rel="noopener noreferrer">' + esc(p.v) + '</a>' : esc(p.v); }).join(''); }
  function rowHtml(r, width, th) {
    if (r.length === 1 && width > 1) return '<tr><' + (th ? 'th' : 'td') + ' colspan="' + width + '" style="' + CELL + ';background:#f6f7f8;font-weight:' + (th ? '700' : '600') + '">' + inlineHtml(r[0]) + '</' + (th ? 'th' : 'td') + '></tr>';
    var cells = ''; for (var i = 0; i < width; i++) cells += '<' + (th ? 'th' : 'td') + ' style="' + CELL + (th ? ';background:#f1f3f4' : '') + '">' + inlineHtml(r[i] || '') + '</' + (th ? 'th' : 'td') + '>'; return '<tr>' + cells + '</tr>';
  }
  // the same message as safe HTML with inline styles (for emails and the portal)
  function html(text) {
    return parse(text).map(function (b) {
      if (b.t === 'hr') return '<hr style="border:0;border-top:1px solid #d8dcde;margin:12px 0">';
      if (b.t === 'code') return '<pre style="background:#f1f3f4;border:1px solid #e1e4e6;border-radius:6px;padding:10px;overflow:auto;font-family:Menlo,Consolas,monospace;font-size:13px;white-space:pre">' + esc(b.text) + '</pre>';
      if (b.t === 'table') return '<div style="overflow:auto"><table style="border-collapse:collapse;font-size:14px;margin:8px 0"><thead>' + b.head.map(function (r) { return rowHtml(r, b.width, true); }).join('') + '</thead><tbody>' + b.body.map(function (r) { return rowHtml(r, b.width, false); }).join('') + '</tbody></table></div>';
      return '<div style="white-space:pre-wrap;margin:0 0 8px">' + inlineHtml(b.text) + '</div>';
    }).join('');
  }
  root.EffFormat = { parse: parse, inline: inline, html: html };
})(typeof globalThis !== 'undefined' ? globalThis : this);
