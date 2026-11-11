// src/pdf-import.js: A PDF BECOMES AN ARTICLE. Text keeps its structure (title, headings, paragraphs, bold, italic, lists, links) and the pictures come along, placed where they sit on the page. Text is read from the file itself (no scanning): a PDF that is only a picture of text has nothing to read and says so. Output is plain HTML that still goes through html-clean.js; pictures are returned as bytes with src="img:<n>" for the caller to store.
//   Limits: 5 MB, 40 pages, 30 pictures. Columns are read top to bottom as one; tables come out as lines of text.
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

export const MAX_PDF = 5 * 1024 * 1024, MAX_PAGES = 40, MAX_IMAGES = 30;
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---- a PNG from raw pixels (no native libraries): filter 0 rows, zlib, CRC
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
// kind: 1 = 1 bit grey, 2 = RGB, 3 = RGBA (pdf.js image kinds)
export function encodePng(width, height, data, kind) {
  const step = Math.max(1, Math.ceil(width / 1400)), w = Math.ceil(width / step), h = Math.ceil(height / step), ch = kind === 3 ? 4 : 3, rowLen = 1 + w * ch, raw = Buffer.alloc(rowLen * h);
  for (let y = 0; y < h; y++) {
    raw[y * rowLen] = 0; const sy = y * step;
    for (let x = 0; x < w; x++) {
      const sx = x * step; let r, g, b, a = 255;
      if (kind === 1) { const bit = (data[sy * Math.ceil(width / 8) + (sx >> 3)] >> (7 - (sx & 7))) & 1; r = g = b = bit ? 255 : 0; }
      else if (kind === 2) { const i = (sy * width + sx) * 3; r = data[i]; g = data[i + 1]; b = data[i + 2]; }
      else { const i = (sy * width + sx) * 4; r = data[i]; g = data[i + 1]; b = data[i + 2]; a = data[i + 3]; }
      const o = y * rowLen + 1 + x * ch; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; if (ch === 4) raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]);
}

let pdfjsP = null;
const pdfjs = () => pdfjsP || (pdfjsP = (async () => {
  const lib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  try { lib.GlobalWorkerOptions.workerSrc = 'file://' + createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'); } catch { /* the library finds its own worker */ }
  return lib;
})());

const BULLET = /^\s*([•●▪◦■□‣⁃•\-–*])\s+/, NUMBERED = /^\s*(\d{1,3})[.)]\s+/;
const isBold = n => /bold|black|heavy|semibold|demi/i.test(n || ''), isItalic = n => /italic|oblique/i.test(n || '');

// -> { ok, title, html, images: [{ bytes, type }], pages, warnings } or { ok: false, error }
export async function pdfToArticle(bytes) {
  if (!bytes || !bytes.length) return { ok: false, error: 'That file is empty.' };
  if (bytes.length > MAX_PDF) return { ok: false, status: 413, error: 'PDF files can be up to 5 MB.' };
  if (bytes.slice(0, 5).toString() !== '%PDF-') return { ok: false, status: 415, error: 'That does not look like a PDF.' };
  const lib = await pdfjs(), warnings = [];
  let doc; try { doc = await lib.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }).promise; } catch (e) { return { ok: false, error: /password/i.test(e.message) ? 'That PDF is password protected.' : 'That PDF could not be read.' }; }
  const pageCount = Math.min(doc.numPages, MAX_PAGES); if (doc.numPages > MAX_PAGES) warnings.push(`Only the first ${MAX_PAGES} pages were imported.`);
  const OPS = lib.OPS, blocks = [], images = [], sizeVotes = new Map(); let imgSeen = 0;
  for (let p = 1; p <= pageCount; p++) {
    const page = await doc.getPage(p), ops = await page.getOperatorList(), tc = await page.getTextContent(), annots = await page.getAnnotations().catch(() => []);
    const links = annots.filter(a => a.subtype === 'Link' && a.url && /^https?:\/\//i.test(a.url) && a.rect).map(a => ({ url: a.url, r: a.rect }));
    const fontOf = id => { try { if (!page.commonObjs.has(id)) return {}; const f = page.commonObjs.get(id); return { bold: !!(f.bold || f.black || isBold(f.name)), italic: !!(f.italic || isItalic(f.name)) }; } catch { return {}; } };
    // text items -> lines (same baseline), each a list of styled runs
    const items = tc.items.filter(i => i.str !== undefined && i.transform).map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], h: Math.abs(i.transform[3]) || i.height || 10, w: i.width, font: fontOf(i.fontName) }));
    items.sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);
    const lines = []; for (const it of items) { const l = lines[lines.length - 1]; if (l && Math.abs(l.y - it.y) <= 2.5) l.items.push(it); else lines.push({ y: it.y, items: [it] }); }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x); const runs = [];
      let prevEnd = null;
      for (const it of l.items) {
        if (!it.s) continue; const bold = !!it.font.bold, italic = !!it.font.italic, link = links.find(k => it.x >= k.r[0] - 1 && it.x <= k.r[2] + 1 && it.y >= k.r[1] - 4 && it.y <= k.r[3] + 4);
        let text = it.s; if (prevEnd !== null && it.x - prevEnd > it.h * 0.15 && !/^\s/.test(text) && runs.length && !/\s$/.test(runs[runs.length - 1].t)) text = ' ' + text;
        prevEnd = it.x + it.w; const last = runs[runs.length - 1];
        if (last && last.bold === bold && last.italic === italic && last.href === (link ? link.url : '')) last.t += text; else runs.push({ t: text, bold, italic, href: link ? link.url : '' });
      }
      const text = runs.map(r => r.t).join('').trim(); if (!text) continue;
      const size = Math.round(Math.max(...l.items.map(i => i.h)) * 2) / 2, chars = text.length, boldChars = runs.filter(r => r.bold).reduce((n, r) => n + r.t.length, 0);
      sizeVotes.set(size, (sizeVotes.get(size) || 0) + chars);
      blocks.push({ page: p, kind: 'line', y: l.y, size, runs, text, allBold: boldChars >= chars * 0.8, x: Math.min(...l.items.map(i => i.x)) });
    }
    // pictures: where each one sits on the page comes from the transform in effect when it is painted
    const stack = []; let ctm = [1, 0, 0, 1, 0, 0];
    const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k], a = ops.argsArray[k];
      if (fn === OPS.save) stack.push(ctm.slice()); else if (fn === OPS.restore) ctm = stack.pop() || ctm; else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
        imgSeen++; if (images.length >= MAX_IMAGES) continue;
        const wPt = Math.hypot(ctm[0], ctm[1]), hPt = Math.hypot(ctm[2], ctm[3]); if (wPt < 40 || hPt < 40) continue;        // icons and rules
        let img = null; try { img = fn === OPS.paintInlineImageXObject ? a[0] : await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout')), 4000); page.objs.get(a[0], v => { clearTimeout(t); res(v); }); }); } catch { img = null; }
        if (!img || !img.data || !img.width || !img.height || ![1, 2, 3].includes(img.kind)) { warnings.push('A picture could not be read and was left out.'); continue; }
        let png; try { png = encodePng(img.width, img.height, img.data, img.kind); } catch { continue; }
        if (png.length > 3.5 * 1024 * 1024) { warnings.push('A very large picture was left out.'); continue; }
        images.push({ bytes: png, type: 'image/png' }); blocks.push({ page: p, kind: 'image', y: ctm[5] + hPt, n: images.length - 1, wPt });
      }
    }
  }
  if (!blocks.some(b => b.kind === 'line')) return { ok: false, error: 'That PDF has no text to read. It may be scanned pictures. Run it through text recognition first, or paste the text.' };
  // body size = the size most text is set in
  let body = 11, best = 0; for (const [s, n] of sizeVotes) if (n > best) { best = n; body = s; }
  blocks.sort((a, b) => a.page - b.page || b.y - a.y);
  const inline = runs => runs.map(r => { let t = esc(r.t); if (r.italic) t = `<em>${t}</em>`; if (r.bold) t = `<strong>${t}</strong>`; if (r.href) t = `<a href="${esc(r.href)}">${t}</a>`; return t; }).join('');
  const out = []; let para = null, list = null, title = '', lastY = null, lastPage = 0, lastSize = 0;
  const flush = () => { if (para) { out.push('<p>' + para.map(inline).join(' ') + '</p>'); para = null; } if (list) { out.push(`<${list.tag}>${list.items.join('')}</${list.tag}>`); list = null; } };
  const firstLine = blocks.find(b => b.kind === 'line'), titleSize = Math.max(...blocks.filter(b => b.kind === 'line').map(b => b.size));
  for (const b of blocks) {
    if (b.kind === 'image') { flush(); out.push(`<figure><img src="img:${b.n}" alt=""></figure>`); lastY = null; continue; }
    const heading = b.size >= body * 1.45 ? 'h2' : (b.size >= body * 1.15 || (b.allBold && b.text.length < 90 && b.size >= body && !BULLET.test(b.text) && !NUMBERED.test(b.text))) ? 'h3' : null;
    if (!title && b === firstLine && b.size === titleSize && b.size >= body * 1.45 && blocks.filter(x => x.kind === 'line' && x.size === titleSize).length === 1) { title = b.text.slice(0, 200); continue; }
    if (heading) { flush(); out.push(`<${heading}>${inline(b.runs.map(r => ({ ...r, bold: false })))}</${heading}>`); lastY = null; continue; }
    let m;
    if ((m = b.text.match(BULLET))) { if (para) flush(); if (!list || list.tag !== 'ul') { flush(); list = { tag: 'ul', items: [] }; } list.items.push('<li>' + inline(trimStart(b.runs, BULLET)) + '</li>'); lastY = b.y; continue; }
    if ((m = b.text.match(NUMBERED))) { if (para) flush(); if (!list || list.tag !== 'ol') { flush(); list = { tag: 'ol', items: [] }; } list.items.push('<li>' + inline(trimStart(b.runs, NUMBERED)) + '</li>'); lastY = b.y; continue; }
    if (list) { const li = list.items.length - 1; if (lastY !== null && lastY - b.y < b.size * 1.8 && b.page === lastPage) { list.items[li] = list.items[li].replace(/<\/li>$/, ' ' + inline(b.runs) + '</li>'); lastY = b.y; continue; } flush(); }
    const gap = lastY === null || b.page !== lastPage ? Infinity : lastY - b.y;
    if (para && gap > b.size * 1.9) flush();
    (para = para || []).push(b.runs); lastY = b.y; lastPage = b.page; lastSize = b.size;
  }
  flush();
  if (!out.length) return { ok: false, error: 'Nothing could be turned into an article from that PDF.' };
  return { ok: true, title, html: out.join('\n'), images, pages: pageCount, warnings: [...new Set(warnings)] };
}
// remove the bullet/number from the first run
function trimStart(runs, re) { const copy = runs.map(r => ({ ...r })); copy[0].t = copy[0].t.replace(re, ''); return copy; }
