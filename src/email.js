// src/email.js: SENDS THE MAIL THE PRODUCT ITSELF NEEDS (verify your address, reset a password, an invitation). Uses Resend's HTTP API; tests pass their own transport.
import { PRODUCT } from './config.js';
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function makeMailer({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM || `${PRODUCT.name} <no-reply@effdesk.com>`, transport } = {}) {
  const send = transport || (async msg => {
    if (!apiKey) { console.warn('RESEND_API_KEY is not set: mail not sent:', msg.subject); return; }
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: msg.from || from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), ...(msg.headers ? { headers: msg.headers } : {}), ...(msg.attachments ? { attachments: msg.attachments } : {}) }) });
    if (!r.ok) throw new Error(`mail provider answered ${r.status}`);
  });
  const mail = (to, subject, line, url, button) => send({ to, subject, text: `${line}\n\n${url}\n\n${PRODUCT.name}`, html: `<p>${esc(line)}</p><p><a href="${esc(url)}">${esc(button)}</a></p><p style="color:#68737d">${esc(PRODUCT.name)}</p>` });
  return {
    verify: (to, url) => mail(to, `Confirm your email for ${PRODUCT.name}`, 'Confirm your email address to finish creating your account.', url, 'Confirm email'),
    reset: (to, url) => mail(to, `Reset your ${PRODUCT.name} password`, 'Someone asked to reset the password for this account. If it was you, use the link below. If not, ignore this email.', url, 'Choose a new password'),
    portalLink: (to, url, orgName, lang) => lang === 'es'
      ? mail(to, `Tu enlace de acceso a ${orgName}`, `Usa este enlace para ver tus solicitudes en ${orgName}. Sirve una vez durante 30 minutos. Si no lo pediste, ignora este correo.`, url, 'Ver mis solicitudes')
      : mail(to, `Your sign-in link for ${orgName}`, `Use this link to see your requests with ${orgName}. It works once for 30 minutes. If you did not ask for it, ignore this email.`, url, 'See my requests'),
    ticketMail: msg => send(msg),                       // a ticket reply: own From, Reply-To and threading headers
    invite: (to, url, who, org) => mail(to, `${who} invited you to ${org} on ${PRODUCT.name}`, `${who} invited you to join ${org} as an agent.`, url, 'Accept the invitation'),
  };
}
