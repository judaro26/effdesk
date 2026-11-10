// src/email.js: SENDS THE MAIL THE PRODUCT ITSELF NEEDS (verify your address, reset a password, an invitation). Uses Resend's HTTP API; tests pass their own transport.
import { PRODUCT } from './config.js';
const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// THE LOOK OF EVERY EMAIL THE PRODUCT SENDS: a card with the EffDesk name, a clear heading, one button, and the plain link below it (for mail programs that hide buttons). Inline styles only: mail programs ignore style sheets.
export function emailLayout({ preheader = '', heading, paragraphs = [], button, url, button2, url2, foot = '' }) {
  const ink = '#1d2428', muted = '#68737d', accent = '#e8890c';
  const p = t => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${ink}">${esc(t)}</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f1ea"><span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e6e1d6;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<tr><td style="padding:28px 32px 8px"><span style="font-size:22px;font-weight:800;color:${ink}">Eff<span style="color:${accent}">Desk</span></span></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;color:${ink}">${esc(heading)}</h1>${paragraphs.map(p).join('')}</td></tr>
${button && url ? `<tr><td style="padding:4px 32px 8px"><a href="${esc(url)}" style="display:inline-block;background:${accent};color:#1d1100;font-weight:700;font-size:16px;text-decoration:none;padding:13px 26px;border-radius:9px">${esc(button)}</a>${button2 && url2 ? ` <a href="${esc(url2)}" style="display:inline-block;background:#ffffff;color:${ink};border:1px solid #cfc8b8;font-weight:700;font-size:16px;text-decoration:none;padding:12px 24px;border-radius:9px;margin-left:8px">${esc(button2)}</a>` : ''}</td></tr>
<tr><td style="padding:16px 32px 0"><p style="margin:0;font-size:13px;line-height:1.5;color:${muted}">Button not working? Copy this link into your browser:<br><a href="${esc(url)}" style="color:${muted};word-break:break-all">${esc(url)}</a></p></td></tr>` : ''}
<tr><td style="padding:24px 32px 28px"><p style="margin:0;font-size:13px;line-height:1.5;color:${muted}">${esc(foot)}</p></td></tr>
</table><p style="margin:16px 0 0;font-size:12px;color:${muted};font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">${esc(PRODUCT.name)}, a simple and affordable help desk.</p>
</td></tr></table></body></html>`;
}
const textOf = ({ heading, paragraphs = [], url, foot = '' }) => [heading, '', ...paragraphs.flatMap(p => [p, '']), ...(url ? [url, ''] : []), foot, '', PRODUCT.name].join('\n');

import { info as logInfo, error as logError } from './log.js';
export function makeMailer({ apiKey = process.env.RESEND_API_KEY, from = process.env.MAIL_FROM || `${PRODUCT.name} <no-reply@effdesk.com>`, transport } = {}) {
  const send0 = transport || (async msg => {
    if (!apiKey) { console.warn('RESEND_API_KEY is not set: mail not sent:', msg.subject); return; }
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: msg.from || from, to: msg.to, ...(msg.cc && msg.cc.length ? { cc: msg.cc } : {}), subject: msg.subject, html: msg.html, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}), ...(msg.headers ? { headers: msg.headers } : {}), ...(msg.attachments ? { attachments: msg.attachments } : {}) }) });
    if (!r.ok) throw new Error(`mail provider answered ${r.status}`);
  });
  const send = async msg => { const t0 = Date.now(); try { const r = await send0(msg); logInfo('email', { ok: true, ms: Date.now() - t0, to_domain: String(msg.to || '').split('@')[1] }); return r; } catch (err) { logError('email', { ok: false, ms: Date.now() - t0, error: err }); throw err; } };
  const mail = (to, subject, spec) => send({ to, subject, text: textOf(spec), html: emailLayout(spec) });
  return {
    verify: (to, url, { company, name } = {}) => mail(to, `Confirm your email to set up ${company || PRODUCT.name}`, { preheader: 'One click and you can choose your plan.', heading: name ? `Welcome, ${name}!` : 'Welcome to EffDesk!', paragraphs: [company ? `You are one step away from setting up ${company}. Confirm your email address, then choose a plan (the free plan includes 2 agents) and your workspace is created right away.` : 'Confirm your email address to finish creating your account.', 'The link works for one hour.'], button: 'Confirm my email', url, foot: 'If you did not create an account, you can ignore this email and nothing will happen.' }),
    reset: (to, url) => mail(to, `Reset your ${PRODUCT.name} password`, { preheader: 'Choose a new password.', heading: 'Reset your password', paragraphs: ['Someone asked to reset the password for this account. If it was you, use the button below to choose a new one.'], button: 'Choose a new password', url, foot: 'If you did not ask for this, ignore this email. Your password has not changed.' }),
    invite: (to, url, who, org) => mail(to, `${who} invited you to ${org} on ${PRODUCT.name}`, { preheader: `Join ${org} as an agent.`, heading: `Join ${org}`, paragraphs: [`${who} invited you to join ${org} as an agent on ${PRODUCT.name}.`], button: 'Accept the invitation', url, foot: 'If you were not expecting this invitation, you can ignore this email.' }),
    portalLink: (to, url, orgName, lang) => lang === 'es'
      ? mail(to, `Tu enlace de acceso a ${orgName}`, { preheader: 'Ver tus solicitudes.', heading: 'Tus solicitudes', paragraphs: [`Usa este botón para ver tus solicitudes en ${orgName}. Sirve una vez durante 30 minutos.`], button: 'Ver mis solicitudes', url, foot: 'Si no lo pediste, ignora este correo.' })
      : mail(to, `Your sign-in link for ${orgName}`, { preheader: 'See your requests.', heading: 'Your requests', paragraphs: [`Use this button to see your requests with ${orgName}. It works once, for 30 minutes.`], button: 'See my requests', url, foot: 'If you did not ask for this, ignore this email.' }),
    agentNotice: (to, { kind, orgName, number, subject, summary, url }) => {
      const what = kind === 'assigned' ? 'A ticket was assigned to you' : kind === 'sla_breached' ? 'SLA breached' : kind === 'sla_risk' ? 'SLA at risk' : kind === 'mention' ? 'You were mentioned in an internal note' : kind === 'side' ? 'New reply in a side conversation' : 'The customer replied';
      return mail(to, `${what}: #${number} ${subject}`, { preheader: summary || what, heading: what, paragraphs: [`#${number} ${subject} (${orgName})`, ...(summary ? [summary] : [])], button: 'Open the ticket', url, foot: 'You get this because you follow the ticket, own it, or it was assigned to you. You can switch these emails off under Profile and themes on your desk.' });
    },
    csat: (to, { orgName, number, subject, name, good, bad }) => mail(to, `How did we do? #${number} ${subject}`, { preheader: 'One click and an optional comment.', heading: name ? `${name}, how did we do?` : 'How did we do?', paragraphs: [`Your request "${subject}" (#${number}) with ${orgName} was marked solved. Was the support you got good or bad?`], button: 'Good', url: good, button2: 'Bad', url2: bad, foot: `You get this once, when a request is solved. If you are not happy, rating it bad lets ${orgName} know.` }),
    platformNotice: async ({ to, subject, text }) => { for (const t of [].concat(to)) await mail(t, subject, { preheader: subject, heading: 'Customer alert', paragraphs: String(text).split('\n').filter(Boolean) }); },
    ticketMail: msg => send(msg),                       // a ticket reply: own From, Reply-To and threading headers
  };
}
