// src/html-clean.js: THE ONE PLACE ARTICLE HTML IS MADE SAFE. Anything an agent types, pastes, or imports from a PDF passes through clean() before it is stored and again before it is shown. Allow-list only: no scripts, no styles, no event handlers, no forms. Links are https/mailto/relative and open safely; images are our own uploads or https; videos are embeds from three known hosts (or an https file).
import sanitizeHtml from 'sanitize-html';

export const VIDEO_HOSTS = ['www.youtube-nocookie.com', 'www.youtube.com', 'player.vimeo.com', 'www.loom.com'];
const CLASSES = ['callout', 'info', 'tip', 'warning', 'danger', 'video', 'img-s', 'img-m', 'img-l', 'center', 'right', 'lead', 'steps', 'btn'];
const okUrl = (v, schemes) => { try { const u = new URL(v, 'https://x.invalid'); return schemes.includes(u.protocol) || (!/^[a-z][a-z0-9+.-]*:/i.test(String(v).trim()) && !String(v).startsWith('//')); } catch { return false; } };
const OPTS = {
  allowedTags: ['h2', 'h3', 'h4', 'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sub', 'sup', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'img', 'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'iframe', 'video', 'details', 'summary', 'mark', 'kbd'],
  disallowedTagsMode: 'discard',
  allowedAttributes: { a: ['href', 'title', 'target', 'rel'], img: ['src', 'alt', 'width', 'height', 'title', 'loading'], iframe: ['src', 'title', 'allowfullscreen', 'loading'], video: ['src', 'controls', 'poster', 'preload'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'], '*': ['class'] },
  allowedClasses: { '*': CLASSES },
  allowedSchemes: ['https', 'mailto'], allowedSchemesAppliedToAttributes: ['href', 'src', 'poster'], allowProtocolRelative: false,
  transformTags: {
    h1: 'h2', h5: 'h4', h6: 'h4',
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
export function clean(html) {
  const out = sanitizeHtml(String(html || ''), { ...OPTS, allowedSchemes: ['https', 'mailto', 'http'] });
  return out.replace(/<(img|iframe|video)\b([^>]*)>/g, (m, tag, rest) => m.replace(/\s(width|height)="([^"]*)"/g, (x, k, v) => /^\d{1,4}$/.test(v) ? x : ''));
}
export const plainOf = html => sanitizeHtml(String(html || '').replace(/<\/(p|h[1-6]|li|div|tr|td|th|blockquote|figure|figcaption|summary)>|<br\s*\/?>/gi, ' '), { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
const slug = t => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'section';
// adds an id to every h2/h3 and returns the table of contents
export function withToc(html) {
  const toc = [], seen = {};
  const out = String(html).replace(/<h([23])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => { const text = plainOf(inner); if (!text) return m; let id = slug(text); seen[id] = (seen[id] || 0) + 1; if (seen[id] > 1) id += '-' + seen[id]; toc.push({ level: Number(lvl), id, text }); return `<h${lvl} id="${id}">${inner}</h${lvl}>`; });
  return { html: out, toc };
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
