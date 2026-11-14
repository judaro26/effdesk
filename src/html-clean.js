// src/html-clean.js: THE ONE PLACE ARTICLE HTML IS MADE SAFE. Anything an agent types, pastes, or imports from a PDF passes through clean() before it is stored and again before it is shown. Allow-list only: no scripts, no styles, no event handlers, no forms. Links are https/mailto/relative and open safely; images are our own uploads or https; videos are embeds from three known hosts (or an https file).
import sanitizeHtml from 'sanitize-html';

export const VIDEO_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com', 'www.loom.com'];
const CLASSES = ['callout', 'info', 'tip', 'warning', 'danger', 'video', 'img-s', 'img-m', 'img-l', 'img-left', 'img-right', 'img-round', 'img-shadow', 'img-border', 'img-zoom', 'center', 'right', 'lead', 'steps', 'btn', 'tbl-striped', 'tbl-plain'];
// ---- the formatting a writer may apply (like a word processor): colour, size, font, alignment, spacing, indent, table borders and widths. Each value is checked against a strict pattern; nothing that can load a file, position a box or run code is ever allowed.
export const FONTS = ['Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Palatino Linotype', 'Garamond', 'Courier New', 'Lucida Console', 'Impact'];
const FONT_RE = new RegExp('^(?:"?(?:' + FONTS.map(f => f.replace(/ /g, '\\s')).join('|') + ')"?)(?:\\s*,\\s*(?:"?(?:' + FONTS.map(f => f.replace(/ /g, '\\s')).join('|') + ')"?|serif|sans-serif|monospace|cursive))*$', 'i');
const COLOR = [/^#[0-9a-f]{3,8}$/i, /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i, /^hsla?\(\s*\d{1,3}\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/i, /^(?:black|white|red|green|blue|orange|yellow|purple|gray|grey|navy|teal|maroon|olive|silver|lime|aqua|fuchsia|transparent)$/i];
const PX = /^(?:0|(?:[1-9]\d?|1\d\d|2[0-3]\d|240)(?:\.\d)?px)$/, WIDTH = /^(?:(?:100|[1-9]?\d)(?:\.\d{1,2})?%|(?:[1-9]\d{0,3})px)$/;
export const STYLES = {
  'color': COLOR, 'background-color': COLOR,
  'text-align': [/^(?:left|right|center|justify)$/i],
  'font-size': [/^(?:(?:[6-9]|[1-8]\d|9[0-6])(?:\.\d{1,2})?(?:px|pt)|(?:0?\.[5-9]\d?|[1-5](?:\.\d{1,2})?|6)(?:em|rem)|(?:5\d|[6-9]\d|[1-3]\d\d|400)%)$/i],
  'font-family': [FONT_RE],
  'font-weight': [/^(?:normal|bold|bolder|lighter|[1-9]00)$/i], 'font-style': [/^(?:normal|italic)$/i],
  'text-decoration': [/^(?:none|underline|line-through|underline line-through|line-through underline)$/i],
  'line-height': [/^(?:[1-3](?:\.\d{1,2})?|(?:1[0-9]\d|2\d\d|300)%)$/],
  'letter-spacing': [/^-?(?:[0-5](?:\.\d)?)px$/], 'text-indent': [PX],
  'vertical-align': [/^(?:top|middle|bottom|baseline)$/i],
  'border': [/^[0-4]px (?:solid|dashed|dotted|double|none) (?:#[0-9a-f]{3,8}|rgba?\([\d\s,.]{5,24}\)|[a-z]+)$/i],
  'border-collapse': [/^(collapse|separate)$/i], 'border-spacing': [/^[0-9.]+(px|pt|em|rem)(\s+[0-9.]+(px|pt|em|rem))?$/],
  'background': [/^(?:#[0-9a-f]{3,8}|[a-z]+)$/i], 'text-transform': [/^(none|uppercase|lowercase|capitalize)$/],
  'white-space': [/^(normal|nowrap|pre|pre-wrap|pre-line)$/], 'word-break': [/^(normal|break-all|keep-all|break-word)$/], 'overflow-wrap': [/^(normal|break-word|anywhere)$/],
  'display': [/^(block|inline|inline-block|table|table-row|table-cell)$/], 'box-sizing': [/^(border-box|content-box)$/],
  'padding': [/^[0-9.]+(px|pt|em|rem|%)?(\s+[0-9.]+(px|pt|em|rem|%)?){0,3}$/],
  'padding-top': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-right': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-bottom': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'margin': [/^[0-9.]+(px|pt|em|rem|%)?(\s+[0-9.]+(px|pt|em|rem|%)?){0,3}$/],
  'margin-top': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-right': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-bottom': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-left': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'max-width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'min-width': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'height': [/^[0-9.]+(px|pt|em|rem|%)$/], 'max-height': [/^[0-9.]+(px|pt|em|rem|%)$/], 'min-height': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'border-top': [/^[0-9.]+px (?:solid|dashed|dotted|double|none) (?:#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-right': [/^[0-9.]+px (?:solid|dashed|dotted|double|none) (?:#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-bottom': [/^[0-9.]+px (?:solid|dashed|dotted|double|none) (?:#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-left': [/^[0-9.]+px (?:solid|dashed|dotted|double|none) (?:#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-radius': [/^[0-9.]+(px|pt|em|rem|%)$/], 'float': [/^(left|right|none)$/], 'clear': [/^(both|left|right|none)$/],
  'list-style-type': [/^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/],
};
export const FONT_SIZES = { 1: '10px', 2: '13px', 3: '16px', 4: '18px', 5: '24px', 6: '32px', 7: '48px' };      // the old <font size> steps that word processors paste
const okUrl = (v, schemes) => { try { const u = new URL(v, 'https://x.invalid'); return schemes.includes(u.protocol) || (!/^[a-z][a-z0-9+.-]*:/i.test(String(v).trim()) && !String(v).startsWith('//')); } catch { return false; } };
const OPTS = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'iframe', 'video', 'details', 'summary', 'mark', 'kbd', 'caption', 'colgroup', 'col', 'center', 'small'],
  disallowedTagsMode: 'discard',
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'title', 'loading'], iframe: ['src', 'title', 'allowfullscreen', 'loading'], video: ['src', 'controls', 'poster', 'preload'], tr: ['align', 'valign', 'bgcolor'], td: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'bgcolor'], th: ['colspan', 'rowspan', 'scope', 'align', 'valign', 'width', 'height', 'bgcolor'], '*': ['class', 'style'], table: ['class', 'style', 'width', 'align', 'cellpadding', 'cellspacing', 'border', 'bgcolor'], col: ['style', 'span'], colgroup: ['span'] },
  allowedStyles: { '*': STYLES },
  allowedClasses: { '*': CLASSES },
  allowedSchemes: ['https', 'mailto'], allowedSchemesAppliedToAttributes: ['href', 'src', 'poster'], allowProtocolRelative: false,
  transformTags: {
    h1: 'h2', h5: 'h4', h6: 'h4',
    font: (tag, at) => { const st = []; if (at.color) st.push('color:' + at.color); if (at.face) st.push('font-family:' + String(at.face).replace(/[;"<>]/g, '')); if (FONT_SIZES[at.size]) st.push('font-size:' + FONT_SIZES[at.size]); return { tagName: 'span', attribs: st.length ? { style: st.join(';') } : {} }; },
    a: (tag, at) => { const href = at.href || ''; if (!/^(https?:|mailto:|#|\/(?!\/))/i.test(String(href).trim())) return { tagName: 'span', attribs: {} };   // no safe address: keep the words, lose the link
       const out = { href }; if (at.title) out.title = at.title; if (/^https?:/i.test(href)) { out.target = '_blank'; out.rel = 'noopener noreferrer'; } return { tagName: 'a', attribs: out }; },
    img: (tag, at) => ({ tagName: 'img', attribs: { ...at, loading: 'lazy', alt: at.alt || '' } }),
  },
  exclusiveFilter: f => {
    if (f.tag === 'iframe') { try { const u = new URL(f.attribs.src || ''); return !(u.protocol === 'https:' && VIDEO_HOSTS.includes(u.hostname) && (u.pathname.startsWith('/embed/') || u.hostname === 'player.vimeo.com')); } catch { return true; } }
    if (f.tag === 'img') return !f.attribs.src || !(/^https:\/\//i.test(f.attribs.src) || /^\/(help\/[a-z0-9-]{1,60}\/)?img\/[a-f0-9-]{36}$/.test(f.attribs.src));
    if (f.tag === 'video') return !f.attribs.src || !/^https:\/\//i.test(f.attribs.src);
    return false;
  },
};
// a bare <img width="..."> may only hold digits
export function clean(html, { allowCidImages = false } = {}) {
  const out = sanitizeHtml(String(html || ''), {
    ...OPTS,
    allowedSchemes: allowCidImages ? ['https', 'mailto', 'http', 'cid'] : ['https', 'mailto', 'http'],
    exclusiveFilter: f => {
      if (f.tag === 'iframe') { try { const u = new URL(f.attribs.src || ''); return !(u.protocol === 'https:' && VIDEO_HOSTS.includes(u.hostname) && (u.pathname.startsWith('/embed/') || u.hostname === 'player.vimeo.com')); } catch { return true; } }
      if (f.tag === 'img') return !f.attribs.src || !(/^https:\/\//i.test(f.attribs.src) || /^\/(help\/[a-z0-9-]{1,60}\/)?img\/[a-f0-9-]{36}$/.test(f.attribs.src) || (allowCidImages && /^cid:[^\s"'<>]{1,200}$/i.test(f.attribs.src)));
      if (f.tag === 'video') return !f.attribs.src || !/^https:\/\//i.test(f.attribs.src);
      return false;
    },
  });
  return out.replace(/<(img|iframe|video)\b([^>]*)>/g, (m, tag, rest) => m.replace(/\s(width|height)="([^"]*)"/g, (x, k, v) => /^\d{1,4}$/.test(v) ? x : ''));
}
export const plainOf = html => sanitizeHtml(String(html || '').replace(/<\/(p|h[1-6]|li|div|tr|td|th|blockquote|figure|figcaption|summary)>|<br\s*\/?>/gi, ' '), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'section';
// adds an id to every h2/h3 and returns the table of contents
export function withToc(html) {
  const toc = [], seen = {};
  const out = String(html).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => { const text = plainOf(inner); if (!text) return m; let id = slug(text); seen[id] = (seen[id] || 0) + 1; if (seen[id] > 1) id += '-' + seen[id]; toc.push({ level: Number(lvl), id, text }); return `<h${lvl} id="${id}">${inner}</h${lvl}>`; });
  const wrapped = out.replace(/<table\b/g, '<div class="tbl-wrap"><table').replace(/<\/table>/g, '</table></div>');          // wide tables scroll inside their own box on small screens
  return { html: wrapped, toc };
}
// a video link someone pastes -> the embed address, or null
export function videoEmbed(url) {
  let u; try { u = new URL(String(url).trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = u.hostname.replace(/^www\./, '');
  if (h === 'youtu.be') { const id = u.pathname.slice(1); return /^[\w-]{6,20}$/.test(id) ? 'https://www.youtube-nocookie.com/embed/' + id : null; }
  if (h === 'youtube.com' || h === 'youtube-nocookie.com') { const id = u.searchParams.get('v') || (u.pathname.match(/^\/(?:embed|shorts)\/([\w-]{6,20})/) || [])[1]; return id && /^[\w-]{6,20}$/.test(id) ? 'https://www.youtube-nocookie.com/embed/' + id : null; }
  if (h === 'vimeo.com' || h === 'player.vimeo.com') { const id = (u.pathname.match(/(\d{5,12})/) || [])[1]; return id ? 'https://player.vimeo.com/video/' + id : null; }
  if (h === 'loom.com') { const id = (u.pathname.match(/^\/(?:share|embed)\/([a-f0-9]{20,40})/) || [])[1]; return id ? 'https://www.loom.com/embed/' + id : null; }
  return null;
}
