// src/ticket-mail.js: EMAIL FOR TICKETS. Out: an agent's public reply is emailed to the requester. In: Resend posts a customer's email to a webhook, which becomes a new ticket or a reply on an existing one.
// Reply modes (set per organization): 'ticket' = the customer's reply comes back into the ticket (Reply-To is a private address for that ticket); 'custom' = Reply-To is an address the organization chose (for example its own support mailbox); 'none' = a no-reply address.
import crypto from 'crypto';
import sanitizeHtml from 'sanitize-html';
import { withOrg } from './db.js';
import { inboundDomain } from './config.js';
import { getEntitlements } from './billing.js';
import { mailLimit } from './plans.js';
import { createTicket, addRequesterMessage, ticketByMessageId, messageSeen } from './tickets.js';
import { sideTokenOk, sideReplyIn } from './desk.js';
import '../public/js/format.js';

const EMAIL_ALLOWED_STYLES = { '*': {
  'color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i], 'background-color': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i], 'background': [/^#[0-9a-f]{3,8}$/i, /^[a-z]+$/i],
  'text-align': [/^(left|right|center|justify)$/], 'vertical-align': [/^(top|middle|bottom|baseline)$/], 'font-weight': [/^(bold|normal|[1-9]00)$/],
  'font-size': [/^[0-9.]+(px|pt|em|rem|%)$/], 'line-height': [/^[0-9.]+(px|pt|em|rem|%)?$/], 'font-family': [/^[a-zA-Z0-9 ,"'_-]+$/],
  'letter-spacing': [/^-?[0-9.]+(px|pt|em|rem)$/], 'text-transform': [/^(none|uppercase|lowercase|capitalize)$/], 'text-decoration': [/^(none|underline|line-through)$/],
  'white-space': [/^(normal|nowrap|pre|pre-wrap|pre-line)$/], 'word-break': [/^(normal|break-all|keep-all|break-word)$/], 'overflow-wrap': [/^(normal|break-word|anywhere)$/],
  'display': [/^(block|inline|inline-block|table|table-row|table-cell)$/], 'box-sizing': [/^(border-box|content-box)$/], 'border-collapse': [/^(collapse|separate)$/],
  'border-spacing': [/^[0-9.]+(px|pt|em|rem)(\s+[0-9.]+(px|pt|em|rem))?$/],
  'padding': [/^[0-9.]+(px|pt|em|rem|%)?(\s+[0-9.]+(px|pt|em|rem|%)?){0,3}$/],
  'padding-top': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-right': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-bottom': [/^[0-9.]+(px|pt|em|rem|%)$/], 'padding-left': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'margin': [/^[0-9.]+(px|pt|em|rem|%)?(\s+[0-9.]+(px|pt|em|rem|%)?){0,3}$/],
  'margin-top': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-right': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-bottom': [/^[0-9.]+(px|pt|em|rem|%)$/], 'margin-left': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'max-width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'min-width': [/^[0-9.]+(px|pt|em|rem|%)$/], 'height': [/^[0-9.]+(px|pt|em|rem|%)$/], 'max-height': [/^[0-9.]+(px|pt|em|rem|%)$/], 'min-height': [/^[0-9.]+(px|pt|em|rem|%)$/],
  'border': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-top': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i], 'border-right': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-bottom': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i], 'border-left': [/^[0-9.]+px\s+(solid|dashed|dotted|double|none)\s+(#[0-9a-f]{3,8}|[a-z]+)$/i],
  'border-radius': [/^[0-9.]+(px|pt|em|rem|%)$/], 'border-collapse': [/^(collapse|separate)$/], 'border-spacing': [/^[0-9.]+(px|pt|em|rem)(\s+[0-9.]+(px|pt|em|rem))?$/], 'box-sizing': [/^(border-box|content-box)$/], 'float': [/^(left|right|none)$/], 'clear': [/^(both|left|right|none)$/], 'list-style-type': [/^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/]
} };

const INBOUND_EMAIL_TAGS = ['a','abbr','b','blockquote','br','caption','center','code','div','em','font','h1','h2','h3','h4','hr','i','img','li','ol','p','pre','section','small','span','strong','sub','sup','table','tbody','td','tfoot','th','thead','tr','u','ul'];
const INBOUND_EMAIL_ATTRS = { '*': ['style','class','align','valign','width','height','bgcolor'], a: ['href','name','target','title'], img: ['src','alt','width','height','title'], td: ['colspan','rowspan','align','valign','width','bgcolor'], th: ['colspan','rowspan','align','valign','width','bgcolor'], table: ['width','cellpadding','cellspacing','border','align','bgcolor'], font: ['color','face','size'] };
export function cleanInboundHtml(html) {
  if (!html) return '';
  return sanitizeHtml(String(html).slice(0, 100000), { allowedTags: INBOUND_EMAIL_TAGS, allowedAttributes: INBOUND_EMAIL_ATTRS, allowedStyles: EMAIL_ALLOWED_STYLES, allowedSchemes: ['http','https','mailto','cid'], allowedSchemesAppliedToAttributes: ['href','src'], allowProtocolRelative: false, transformTags: { a: (tag, a) => ({ tagName: 'a', attribs: /^https?:|^mailto:/i.test(a.href || '') ? { href: a.href, target: '_blank', rel: 'noopener noreferrer' } : {} }), img: (tag, a) => ({ tagName: 'img', attribs: { src: a.src || '', alt: String(a.alt || '').slice(0,300), width: a.width || '', height: a.height || '' } }) }, disallowedTagsMode: 'discard' });
}
const htmlText = html => sanitizeHtml(String(html || ''), { allowedTags: [], allowedAttributes: {} }).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const fmtHtml = t => globalThis.EffFormat.html(t);          // tables, ``` code, --- lines and links, with everything escaped first

export const MODES = ['ticket', 'custom', 'none'];
const RESERVED = new Set(['admin', 'administrator', 'postmaster', 'abuse', 'no-reply', 'noreply', 'mailer-daemon', 'root', 'webmaster', 'hostmaster', 'security', 'support', 'help', 'info', 'billing', 'sales', 'effdesk', 'www', 'mail', 'test']);
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000\r\n]/g, ' ').trim().slice(0, max);
const isEmail = s => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(s) && s.length <= 254;
const esc = v => String(v == null ? '' : v).replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"');
const fail = (error, status = 400) => ({ ok: false, status, error });
const tokenSecret = env => String(env.EMAIL_TOKEN_SECRET || env.BETTER_AUTH_SECRET || '');
export const ticketToken = (env, orgId, number) => crypto.createHmac('sha256', tokenSecret(env)).update(`ticket:${orgId}:${number}`).digest('hex').slice(0, 12);
const tokenOk = (env, orgId, number, tok) => { const want = Buffer.from(ticketToken(env, orgId, number)), got = Buffer.from(String(tok || '')); return !!tokenSecret(env) && want.length === got.length && crypto.timingSafeEqual(want, got); };

// ---------- settings ----------
export const suggestInbox = slug => String(slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
export async function getMailSettings(pool, orgId, env = process.env) {
  const domain = inboundDomain(env);
  return withOrg(pool, orgId, async c => {
    const inbox = (await c.query('select inbox from inbox_directory where org_id = $1', [orgId])).rows[0]?.inbox || '';
    const s = (await c.query('select reply_mode, reply_to, from_name, signature from mail_settings where org_id = $1', [orgId])).rows[0] || { reply_mode: 'ticket', reply_to: null, from_name: '', signature: '' };
    const slug = (await c.query('select slug from "organization" where id = $1', [orgId])).rows[0]?.slug;
    return { ok: true, domain, inbox, suggestedInbox: inbox || suggestInbox(slug), address: inbox ? `${inbox}@${domain}` : '', replyMode: s.reply_mode, replyTo: s.reply_to || '', fromName: s.from_name, signature: s.signature };
  });
}
export async function saveMailSettings(pool, orgId, input, env = process.env) {
  const inbox = String(input.inbox || '').toLowerCase().trim(), mode = MODES.includes(input.replyMode) ? input.replyMode : null;
  if (!mode) return fail('Choose how customers can reply.');
  if (!/^[a-z0-9][a-z0-9-]{2,31}$/.test(inbox)) return fail('The address needs 3 to 32 letters, numbers or dashes.');
  if (RESERVED.has(inbox)) return fail('That address is reserved. Choose another.');
  const replyTo = clean(input.replyTo, 254).toLowerCase();
  if (mode === 'custom' && !isEmail(replyTo)) return fail('Enter the email address replies should go to.');
  if (mode === 'custom' && replyTo.endsWith('@' + inboundDomain(env))) return fail('Use your own address here, or choose "replies come back into the ticket".');
  try {
    await withOrg(pool, orgId, async c => {
      await c.query('insert into inbox_directory (inbox, org_id) values ($1,$2) on conflict (org_id) do update set inbox = excluded.inbox', [inbox, orgId]);
      await c.query(`insert into mail_settings (org_id, reply_mode, reply_to, from_name, signature) values ($1,$2,$3,$4,$5) on conflict (org_id) do update set reply_mode = excluded.reply_mode, reply_to = excluded.reply_to, from_name = excluded.from_name, signature = excluded.signature, updated_at = now()`, [orgId, mode, mode === 'custom' ? replyTo : null, clean(input.fromName, 100), String(input.signature || '').replace(/\u0000/g, '').slice(0, 1000)]);
    });
  } catch (e) { if (e.code === '23505') return fail('That address is already taken. Choose another.', 409); throw e; }
  return getMailSettings(pool, orgId, env);
}

// ---------- outgoing ----------
// Emails an agent's public reply to the requester. Never throws: the reply is already saved, the result says what happened ('sent', 'failed' or 'skipped' with why).
export async function sendTicketReply(pool, mailer, env, orgId, number, messageRowId, files = [], options = {}) {
  const domain = inboundDomain(env);
  try {
    const data = await withOrg(pool, orgId, async c => {
      const t = (await c.query('select id, number, subject, requester_email, requester_name, cc from tickets where org_id = $1 and number = $2', [orgId, number])).rows[0]; if (!t) return null;
      const m = (await c.query('select id, body, author_name from ticket_messages where org_id = $1 and id = $2', [orgId, messageRowId])).rows[0];
      const settings = (await c.query('select reply_mode, reply_to, from_name, signature from mail_settings where org_id = $1', [orgId])).rows[0];
      const inbox = (await c.query('select inbox from inbox_directory where org_id = $1', [orgId])).rows[0]?.inbox;
      const orgName = (await c.query('select name from "organization" where id = $1', [orgId])).rows[0]?.name || '';
      const sentToday = (await c.query("select count(*)::int n from ticket_messages where org_id = $1 and delivery = 'sent' and created_at > now() - interval '24 hours'", [orgId])).rows[0].n;
      const prev = (await c.query("select message_id from ticket_messages where org_id = $1 and ticket_id = $2 and message_id is not null order by created_at desc limit 5", [orgId, t.id])).rows.map(r => r.message_id);
      return { t, m, settings, inbox, orgName, sentToday, prev };
    });
    const mark = (d, mid) => withOrg(pool, orgId, c => c.query('update ticket_messages set delivery = $3, message_id = coalesce($4, message_id) where org_id = $1 and id = $2', [orgId, messageRowId, d, mid || null]));
    if (!data || !data.m) return { delivery: 'skipped', why: 'missing' };
    if (!data.inbox) { await mark('skipped'); return { delivery: 'skipped', why: 'no-inbox' }; }
    const ent = await getEntitlements(pool, orgId);
    if (data.sentToday >= mailLimit(ent)) { await mark('skipped'); return { delivery: 'skipped', why: 'limit' }; }
    const { t, m, settings, inbox, orgName } = data, mode = settings?.reply_mode || 'ticket', display = clean(settings?.from_name, 100) || orgName || 'Support';
    const mid = `<m${m.id}.${crypto.randomBytes(8).toString('hex')}@${domain}>`;
    const from = mode === 'none' ? `${display.replace(/[<>"]/g, '')} <no-reply@${domain}>` : `${display.replace(/[<>"]/g, '')} <${inbox}@${domain}>`;
    const replyTo = mode === 'ticket' ? `${inbox}+${t.number}.${ticketToken(env, orgId, t.number)}@${domain}` : mode === 'custom' ? settings.reply_to : undefined;
    const sig = settings?.signature ? `\n\n-- \n${settings.signature}` : '', foot = mode === 'none' ? '\n\n(This address does not receive replies.)' : '';
    const textBody = options.html ? String(options.html).replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim() : m.body;
    const text = `${textBody}${sig}${foot}`;
    const safeCustomHtml = options.html ? sanitizeHtml(String(options.html), { allowedTags: ['p','br','strong','b','em','i','u','s','ul','ol','li','h1','h2','h3','blockquote','a','table','thead','tbody','tr','th','td','hr','div','span'], allowedAttributes: { a: ['href','name','target'], table: ['role','width','cellpadding','cellspacing','border','align'], tr: ['align','valign'], td: ['align','valign','width','height','bgcolor','colspan','rowspan'], th: ['align','valign','width','height','bgcolor','colspan','rowspan'], '*': ['style'] }, allowedSchemes: ['http','https','mailto'], allowedStyles: EMAIL_ALLOWED_STYLES }) : null;
    const html = `${safeCustomHtml || fmtHtml(m.body)}${settings?.signature ? `<p style="color:#68737d;white-space:pre-wrap">-- <br>${esc(settings.signature)}</p>` : ''}${foot ? `<p style="color:#68737d">${esc(foot.trim())}</p>` : ''}`;
    const headers = { 'Message-ID': mid, ...(data.prev.length ? { 'In-Reply-To': data.prev[0], References: data.prev.slice().reverse().join(' ') } : {}), 'Auto-Submitted': 'no' };
    let providerId; try { providerId = await mailer.ticketMail({ from, to: t.requester_email, ...(t.cc && t.cc.length ? { cc: t.cc } : {}), replyTo, subject: `[#${t.number}] ${t.subject}`, text, html, headers, ...(files.length ? { attachments: files.map(f => ({ filename: f.filename, content: f.bytes.toString('base64') })) } : {}) }); }
    catch (e) { console.warn('ticket mail failed:', e.message); await mark('failed'); return { delivery: 'failed' }; }
    await mark('sent', mid);
    if (providerId) { try { await pool.query('insert into email_receipts (provider_id, org_id, message_id) values ($1,$2,$3) on conflict do nothing', [String(providerId), orgId, messageRowId]); await withOrg(pool, orgId, c => c.query("update ticket_messages set delivery_status = 'sent' where org_id = $1 and id = $2", [orgId, messageRowId])); } catch (e) { console.warn('email receipt not kept:', e.message); } }
    return { delivery: 'sent' };
  } catch (e) { console.warn('ticket mail error:', e.message); return { delivery: 'failed' }; }
}

// ---------- incoming ----------
export function stripQuoted(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n'); let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim(), nx = (lines[i + 1] || '').trim();
    if (/^on .{5,300} wrote:?$/i.test(l) || (/^on .{5,300}[^:]$/i.test(l) && /^.{0,100}wrote:$/i.test(nx)) || /^-{2,}\s*(original message|forwarded message)\s*-{2,}$/i.test(l) || /^_{10,}$/.test(l) || (/^from:\s.+/i.test(l) && /^(sent|date):/i.test(nx))) { cut = i; break; }
  }
  let kept = lines.slice(0, cut); while (kept.length && (kept[kept.length - 1].trim() === '' || kept[kept.length - 1].trim().startsWith('>'))) kept.pop();
  const out = kept.join('\n').trim(); return out || String(text || '').trim();
}
const htmlToText = h => htmlText(String(h || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, ' $1 ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, '\n'));
const hdr = (h, k) => { if (!h) return ''; const key = Object.keys(h).find(x => x.toLowerCase() === k); const v = key ? h[key] : ''; return Array.isArray(v) ? v.join(' ') : String(v || ''); };
export function isAutomated(headers, from) {
  const auto = hdr(headers, 'auto-submitted').toLowerCase().trim(), prec = hdr(headers, 'precedence').toLowerCase().trim();
  return (auto && auto !== 'no') || /^(bulk|junk|list|auto_reply)$/.test(prec) || !!hdr(headers, 'x-auto-response-suppress') || !!hdr(headers, 'list-id') || /^(mailer-daemon|postmaster|no-?reply|do-?not-?reply)@/i.test(from);
}
export const parseAddress = s => { const m = String(s || '').match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/); return m ? { name: clean(m[1], 100), email: m[2].trim().toLowerCase() } : { name: '', email: String(s || '').trim().toLowerCase() }; };

// email = { from, to[], receivedFor[], messageId, subject, text, html, headers, authentication, attachments[] } → { ok, action } or { dropped: why }
export async function handleInbound(pool, env, email) {
  const domain = inboundDomain(env), from = parseAddress(hdr(email.headers, 'from') || email.from);
  if (!isEmail(from.email)) return { dropped: 'bad-sender' };
  if (from.email.endsWith('@' + domain)) return { dropped: 'loop' };
  let target = null;
  for (const a of [...(email.to || []), ...(email.receivedFor || [])]) {
    const m = String(parseAddress(a).email).match(/^([a-z0-9-]+)(?:\+(s?)(\d{1,9})\.([0-9a-f]{12}))?@(.+)$/); if (!m || m[5] !== domain) continue;
    const row = (await pool.query('select org_id from inbox_directory where inbox = $1', [m[1]])).rows[0]; if (row) { target = { orgId: row.org_id, number: m[3] && !m[2] ? Number(m[3]) : 0, tok: m[4], side: m[2] ? Number(m[3]) : 0 }; break; }
  }
  if (!target) return { dropped: 'unknown-inbox' };
  const orgId = target.orgId;

  // Allow verification emails to bypass the automated spam filter
  const isVerificationEmail = [
    'forwarding-noreply@google.com',
    'noreply@notify.cloudflare.com'
  ].includes(from.email.toLowerCase());

  if (!isVerificationEmail && isAutomated(email.headers, from.email)) return { dropped: 'automated' };
  
  if (email.authentication && email.authentication.dmarc === 'fail') return { dropped: 'auth-failed' };
  if (email.messageId && await messageSeen(pool, orgId, email.messageId)) return { dropped: 'duplicate' };
  const recent = (await withOrg(pool, orgId, c => c.query("select count(*)::int n from tickets where org_id = $1 and channel = 'email' and created_at > now() - interval '1 hour'", [orgId]))).rows[0].n;
  if (recent >= 200) return { dropped: 'rate' };
  const htmlBody = cleanInboundHtml(email.html);
  let body = stripQuoted(email.text || htmlToText(email.html)).replace(/\[image:\s*[^\]]+\]/gmi, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!body && htmlBody) body = stripQuoted(htmlToText(email.html)).replace(/\n{3,}/g, '\n\n').trim();
  const att = (email.attachments || []).length;
  if (!body.trim() && att) body = '(no message, see the attached files)';
  if (!body.trim()) return { dropped: 'empty' };
  if (target.side) {                                // the reply of someone a side conversation was written to
    if (!sideTokenOk(env, orgId, target.side, target.tok)) return { dropped: 'bad-token' };
    const r = await sideReplyIn(pool, orgId, target.side, from.email, from.name, body, email.messageId);
    return r.ok ? { ok: true, action: r.action, number: r.number, orgId, summary: body } : r;
  }
  const subject = clean(email.subject, 200).replace(/^\s*\[#\d+\]\s*/, '') || '(no subject)';
  let number = target.number && tokenOk(env, orgId, target.number, target.tok) ? target.number : 0;
  if (!number) {                                    // no private address: a reply is recognised by the Message-ID it answers, and only from the person who opened the ticket
    const irt = hdr(email.headers, 'in-reply-to').trim(), found = irt ? await ticketByMessageId(pool, orgId, irt) : null;
    if (found && found.requester_email === from.email) number = found.number;
  }
  if (number) {
    const r = await addRequesterMessage(pool, orgId, number, { body, htmlBody, authorName: from.name || from.email, messageId: email.messageId });
    if (r.ok) return { ok: true, action: 'replied', number, reopened: r.reopened, orgId, messageRowId: r.messageRowId, summary: body };
    if (!r.closed) return { dropped: 'no-ticket' };
    const f = await createTicket(pool, orgId, null, { subject: `Re: ${subject}`.slice(0, 200), body, htmlBody, requesterEmail: from.email, requesterName: from.name, channel: 'email', messageId: email.messageId });
    return f.ok ? { ok: true, action: 'followup', number: f.ticket.number, orgId, messageRowId: f.messageRowId } : { dropped: 'invalid' };
  }
  const t = await createTicket(pool, orgId, null, { subject, body, htmlBody, requesterEmail: from.email, requesterName: from.name, channel: 'email', messageId: email.messageId });
  return t.ok ? { ok: true, action: 'created', number: t.ticket.number, orgId, messageRowId: t.messageRowId } : { dropped: 'invalid' };
}

// Resend signs webhooks with Svix: svix-id, svix-timestamp and svix-signature ("v1,<base64 hmac of id.timestamp.body>"); the secret is "whsec_" + base64
export function verifySvix(raw, headers, secret, now = Date.now()) {
  try {
    const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sigs = String(headers.get('svix-signature') || '');
    if (!secret || !id || !ts || !sigs || Math.abs(now / 1000 - Number(ts)) > 300) return false;
    const key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'), want = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest();
    return sigs.split(' ').some(p => { const [v, s] = p.split(','); if (v !== 'v1' || !s) return false; const got = Buffer.from(s, 'base64'); return got.length === want.length && crypto.timingSafeEqual(got, want); });
  } catch { return false; }
}

// Resend's delivery reports for emails we sent (email.delivered, email.delivery_delayed, email.bounced, email.complained)
const RECEIPT = { 'email.delivered': 'delivered', 'email.delivery_delayed': 'delayed', 'email.bounced': 'bounced', 'email.complained': 'complained' }, RANK = { sent: 1, delayed: 2, delivered: 3, bounced: 9, complained: 9 };
export const isReceiptEvent = type => type in RECEIPT;
export async function applyReceipt(pool, ev) {
  const st = RECEIPT[ev.type], pid = ev.data && ev.data.email_id; if (!st || !pid) return { ok: false };
  const row = (await pool.query('select org_id, message_id from email_receipts where provider_id = $1', [String(pid)])).rows[0]; if (!row) return { ok: false, unknown: true };
  const why = st === 'bounced' ? clean((ev.data.bounce && (ev.data.bounce.message || ev.data.bounce.type)) || 'The address did not accept the email.', 300) : st === 'complained' ? 'The customer marked it as spam.' : null;
  await withOrg(pool, row.org_id, async c => {
    const cur = (await c.query('select delivery_status from ticket_messages where org_id = $1 and id = $2', [row.org_id, row.message_id])).rows[0]; if (!cur) return;
    if ((RANK[cur.delivery_status] || 0) >= 9 && RANK[st] < 9) return;                 // a bounce stays a bounce
    if ((RANK[cur.delivery_status] || 0) > RANK[st] && RANK[st] < 9) return;           // a late "delayed" never replaces "delivered"
    await c.query('update ticket_messages set delivery_status = $3, delivery_error = $4 where org_id = $1 and id = $2', [row.org_id, row.message_id, st, why]);
  });
  return { ok: true, orgId: row.org_id };
}
// what happened to each agent email of a ticket, for the conversation view: [{ message_id, status, error }]
export async function emailDeliveryOf(pool, orgId, number) {
  return withOrg(pool, orgId, async c => (await c.query("select m.id as message_id, coalesce(m.delivery_status, case m.delivery when 'sent' then 'sent' when 'failed' then 'failed' end) as status, m.delivery_error as error from ticket_messages m join tickets t on t.id = m.ticket_id and t.org_id = m.org_id where m.org_id = $1 and t.number = $2 and m.kind = 'agent' and m.delivery in ('sent','failed')", [orgId, Number(number) || 0])).rows);
}
