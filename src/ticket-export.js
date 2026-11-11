// src/ticket-export.js: A TICKET'S THREAD (or one message) AS A PRINTABLE PAGE (which the browser prints or saves as PDF) OR AS AN EMAIL FILE (.eml, opens in any mail program). Internal notes are left out unless asked for.
import '../public/js/format.js';
const F = globalThis.EffFormat;
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const KIND = { requester: 'Customer', agent: 'Agent', note: 'Internal note', system: 'System' };
export const pick = (messages, { messageId, notes }) => messages.filter(m => (messageId ? String(m.id) === String(messageId) : m.kind !== 'system') && (notes || m.kind !== 'note'));
const when = d => new Date(d).toUTCString().replace('GMT', 'UTC');

export function printPage(t, msgs, { orgName = '', auto = false } = {}) {
  const body = msgs.map(m => `<section class="m ${esc(m.kind)}"><header><b>${esc(m.author_name || (m.kind === 'requester' ? t.requester_email : 'Agent'))}</b> <span>${esc(KIND[m.kind] || '')} · ${esc(when(m.created_at))}</span></header>${m.html_body ? '<div class="email-html">' + m.html_body + '</div>' : F.html(m.body)}${(m.attachments || []).length ? `<p class="f">Files: ${m.attachments.map(a => esc(a.filename)).join(', ')}</p>` : ''}</section>`).join('') || '<p>No messages.</p>';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>#${t.number} ${esc(t.subject)}</title><style>
body{font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:#1d2428;max-width:780px;margin:24px auto;padding:0 20px}h1{font-size:22px;margin:0 0 4px}.meta{color:#55626b;font-size:13px;margin-bottom:18px;border-bottom:2px solid #1d2428;padding-bottom:10px}
.m{border:1px solid #d8dcde;border-radius:8px;padding:10px 14px;margin:0 0 12px;break-inside:avoid}.m.agent{background:#eef5fb}.m.note{background:#fff7d6}.m header{font-size:13px;margin-bottom:6px}.m header span{color:#66737c}.m .email-html img{max-width:100%;height:auto}.m .email-html table{max-width:100%;border-collapse:collapse}.m .email-html td,.m .email-html th{vertical-align:top}.f{font-size:12px;color:#66737c}
.bar{margin-bottom:16px}button{font:inherit;padding:7px 14px;border-radius:6px;border:1px solid #1d2428;background:#1d2428;color:#fff;cursor:pointer}@media print{.bar{display:none}body{margin:0;max-width:none}}</style></head><body>
<div class="bar"><button type="button" id="print">Print or save as PDF</button></div>
<h1>#${t.number} ${esc(t.subject)}</h1><div class="meta">${esc(orgName)}${orgName ? ' · ' : ''}${esc(t.requester_name ? t.requester_name + ' <' + t.requester_email + '>' : t.requester_email)} · Status: ${esc(t.status)} · Opened ${esc(when(t.created_at))}</div>${body}
<script src="/js/print.js"${auto ? ' data-auto="1"' : ''}></script></body></html>`;
}
const b64 = s => Buffer.from(String(s), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
const hdr = v => /^[\x20-\x7e]*$/.test(v) ? v.replace(/[\r\n]/g, ' ') : '=?UTF-8?B?' + Buffer.from(v.replace(/[\r\n]/g, ' ')).toString('base64') + '?=';
const addr = (name, email) => `${hdr(String(name || '').replace(/["<>]/g, ''))} <${String(email).replace(/[<>\s]/g, '')}>`;
// one .eml: a single message as it was sent or received, or the whole thread as one readable email
export function eml(t, msgs, { messageId, supportAddress = 'support@effdesk.invalid' } = {}) {
  const one = messageId && msgs.length === 1 ? msgs[0] : null, text = one ? F.plain(one.body) : msgs.map(m => `${m.author_name || KIND[m.kind]} (${KIND[m.kind]}), ${when(m.created_at)}\n${F.plain(m.body)}`).join('\n\n----------\n\n');
  const htm = one ? F.html(one.body) : msgs.map(m => `<p><b>${esc(m.author_name || KIND[m.kind])}</b> <small>(${esc(KIND[m.kind])}, ${esc(when(m.created_at))})</small></p>${F.html(m.body)}<hr>`).join('');
  const fromAgent = one && one.kind !== 'requester', from = one ? (fromAgent ? addr(one.author_name || 'Support', supportAddress) : addr(t.requester_name || t.requester_email, t.requester_email)) : addr('EffDesk export', supportAddress), to = one ? (fromAgent ? addr(t.requester_name || t.requester_email, t.requester_email) : addr('Support', supportAddress)) : addr(t.requester_name || t.requester_email, t.requester_email), at = one ? one.created_at : t.created_at, bnd = '=_effdesk_' + t.number + '_' + Date.now().toString(36);
  const files = msgs.flatMap(m => (m.attachments || []).map(a => a.filename));
  return ['MIME-Version: 1.0', 'Date: ' + new Date(at).toUTCString().replace('GMT', '+0000'), 'From: ' + from, 'To: ' + to, 'Subject: ' + hdr(`[#${t.number}] ${t.subject}`), `Message-ID: <ticket-${t.number}-${one ? one.id : 'thread'}@export.effdesk>`, 'X-EffDesk-Ticket: ' + t.number, 'X-Unsent: 1', `Content-Type: multipart/alternative; boundary="${bnd}"`, '',
    `--${bnd}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(text + (files.length ? '\n\nFiles (not included): ' + files.join(', ') : '')), `--${bnd}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(`<html><body style="font-family:Arial,sans-serif">${htm}</body></html>`), `--${bnd}--`, ''].join('\r\n');
}
