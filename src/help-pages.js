// src/help-pages.js: THE HTML OF THE HELP CENTER AND THE CUSTOMER PORTAL. Plain server-rendered pages: no script at all, so the strict content policy holds. Every value is escaped.
import '../public/js/format.js';
const fmtHtml = t => globalThis.EffFormat.html(t);          // tables, ``` code, --- lines and links, with everything escaped first
export const esc = v => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const T = {
  en: { help: 'Help center', search: 'Search', searchPh: 'Search for answers', articles: 'Articles', none: 'No articles yet.', noResults: 'Nothing found for', results: 'Results for', helpful: 'Was this article helpful?', yes: 'Yes', no: 'No', thanks: 'Thank you for your feedback.', updated: 'Updated', otherLang: 'Also available in', myTickets: 'My requests', signin: 'Sign in to see your requests', email: 'Your email address', sendLink: 'Email me a sign-in link', checkEmail: 'If that address has requests here, we sent a sign-in link. It works once for 30 minutes.', continue: 'Continue', confirmIn: 'Confirm sign-in', badLink: 'That link has expired or was already used. Request a new one.', requests: 'Your requests', noRequests: 'You have no requests.', status: { open: 'Open', pending: 'Waiting for you', solved: 'Solved', closed: 'Closed' }, reply: 'Your reply', send: 'Send reply', signout: 'Sign out', back: 'Back', closedNote: 'This request is closed. Write to us again to open a new one.', youSaid: 'You', empty: 'Write a message first.', sent: 'Your reply was sent.', notFound: 'We could not find that page.', backHelp: 'Back to the help center', needHelp: 'Cannot find an answer? Sign in to see your requests, or email us.', files: 'Files', lang: 'Language' },
  es: { help: 'Centro de ayuda', search: 'Buscar', searchPh: 'Busca respuestas', articles: 'Artículos', none: 'Aún no hay artículos.', noResults: 'No encontramos nada para', results: 'Resultados para', helpful: '¿Te resultó útil este artículo?', yes: 'Sí', no: 'No', thanks: 'Gracias por tu opinión.', updated: 'Actualizado', otherLang: 'También disponible en', myTickets: 'Mis solicitudes', signin: 'Inicia sesión para ver tus solicitudes', email: 'Tu correo electrónico', sendLink: 'Envíame un enlace de acceso', checkEmail: 'Si ese correo tiene solicitudes aquí, enviamos un enlace de acceso. Sirve una vez durante 30 minutos.', continue: 'Continuar', confirmIn: 'Confirmar acceso', badLink: 'Ese enlace venció o ya se usó. Pide uno nuevo.', requests: 'Tus solicitudes', noRequests: 'No tienes solicitudes.', status: { open: 'Abierta', pending: 'Esperando tu respuesta', solved: 'Resuelta', closed: 'Cerrada' }, reply: 'Tu respuesta', send: 'Enviar respuesta', signout: 'Cerrar sesión', back: 'Volver', closedNote: 'Esta solicitud está cerrada. Escríbenos de nuevo para abrir una nueva.', youSaid: 'Tú', empty: 'Escribe un mensaje primero.', sent: 'Tu respuesta fue enviada.', notFound: 'No encontramos esa página.', backHelp: 'Volver al centro de ayuda', needHelp: '¿No encuentras la respuesta? Inicia sesión para ver tus solicitudes o escríbenos.', files: 'Archivos', lang: 'Idioma' },
};
export const LANG_NAMES = { en: 'English', es: 'Español' };
const date = (d, lang) => { try { return new Date(d).toLocaleDateString(lang === 'es' ? 'es' : 'en', { year: 'numeric', month: 'long', day: 'numeric' }); } catch { return ''; } };

const H = {
  en: { hero: 'How can we help?', heroSub: 'Search our articles or browse by topic.', general: 'General', popular: 'Popular articles', onPage: 'On this page', related: 'Related articles', count: n => n + (n === 1 ? ' article' : ' articles'), more: 'See all', contact: 'Still need help?', contactSub: 'Send us a request and we will get back to you.', submit: 'Submit a request', skip: 'Skip to content', topics: 'Browse by topic', status: 'System status', crumbHome: 'Help center' },
  es: { hero: '¿Cómo podemos ayudarte?', heroSub: 'Busca en nuestros artículos o explora por tema.', general: 'General', popular: 'Artículos populares', onPage: 'En esta página', related: 'Artículos relacionados', count: n => n + (n === 1 ? ' artículo' : ' artículos'), more: 'Ver todos', contact: '¿Sigues necesitando ayuda?', contactSub: 'Envíanos una solicitud y te responderemos.', submit: 'Enviar una solicitud', skip: 'Ir al contenido', topics: 'Explora por tema', status: 'Estado del sistema', crumbHome: 'Centro de ayuda' },
};
export const HT = lang => H[lang] || H.en;
const HEX = /^#[0-9a-fA-F]{6}$/;
// look = { theme, accent } (already checked against the plan); hero = html placed above the page column
export function layout({ org, lang, title, body, base, signedIn, hero = '', wide = false, statusLink = false }) {
  const t = T[lang], h = HT(lang), look = org.look || {}, theme = /^[a-z]{3,12}$/.test(look.theme || '') ? look.theme : 'classic', accent = HEX.test(look.accent || '') ? look.accent : '';
  return `<!doctype html>\n<html lang="${lang}" data-htheme="${theme}"${accent ? ` style="--accent:${accent};--accent-d:${accent}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | ${esc(org.name)}</title><link rel="stylesheet" href="/css/site.css"><link rel="stylesheet" href="/css/help.css"></head><body class="hc-body">
<a class="skip" href="#content">${esc(h.skip)}</a>
<header class="hc-head"><div class="in"><a class="brand" href="${base}?lang=${lang}">${esc(org.name)} <span>${esc(t.help)}</span></a><nav>${statusLink ? `<a href="${base}/status">${esc(h.status)}</a>` : ''}<a href="${base}/tickets?lang=${lang}">${esc(t.myTickets)}</a>${signedIn ? `<form method="post" action="${base}/tickets/logout?lang=${lang}" class="inline"><button class="btn l" type="submit">${esc(t.signout)}</button></form>` : `<a class="btn sm" href="${base}/requests/new?lang=${lang}">${esc(h.submit)}</a>`}</nav></div></header>
${hero}<main id="content" class="${wide ? 'hc-main' : 'doc'}">${body}</main>
<footer><div class="in"><span class="m">${esc(org.name)}</span><span class="m">Powered by EffDesk</span></div></footer>
</body></html>`;
}
export const searchBox = (base, lang, q = '', big = false) => `<form method="get" action="${base}/search" class="search${big ? ' big' : ''}" role="search"><input type="hidden" name="lang" value="${lang}"><input type="search" name="q" value="${esc(q)}" placeholder="${esc(T[lang].searchPh)}" aria-label="${esc(T[lang].search)}" maxlength="100"><button class="btn" type="submit">${esc(T[lang].search)}</button></form>`;
const langLinks = (base, lang, path) => `<p class="m">${esc(T[lang].lang)}: ${Object.keys(LANG_NAMES).map(l => l === lang ? `<strong>${LANG_NAMES[l]}</strong>` : `<a href="${base}${path}?lang=${l}">${LANG_NAMES[l]}</a>`).join(' · ')}</p>`;

const plainEx = x => esc(String(x || '').replace(/[#*`\[\]<>]/g, '')) + '…';
const initialOf = n => esc(String(n || '?').trim().slice(0, 1).toUpperCase());
const link = (base, lang, a) => `${base}/a/${esc(a.slug)}?lang=${a.lang || lang}`;
export function homePage({ org, lang, base, articles, statusLink = false }) {
  const t = T[lang], h = HT(lang), look = org.look || {};
  const groups = new Map(); for (const a of articles) { const k = a.category || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  const cats = [...groups.entries()].sort((x, y) => (x[0] === '') - (y[0] === '') || x[0].localeCompare(y[0]));
  const popular = [...articles].filter(a => Number(a.views) > 0).sort((a, b) => b.views - a.views).slice(0, 6);
  const hero = `<section class="hc-hero"><div class="in"><h1>${esc(look.hero_title || h.hero)}</h1><p>${esc(look.hero_subtitle || h.heroSub)}</p>${searchBox(base, lang, '', true)}</div></section>`;
  const grid = cats.length ? `<h2 class="hc-h">${esc(h.topics)}</h2><div class="hc-cats">${cats.map(([k, list]) => `<section class="hc-cat"><div class="ic" aria-hidden="true">${initialOf(k || h.general)}</div><h3>${esc(k || h.general)}</h3><p class="m">${esc(h.count(list.length))}</p><ul>${list.slice(0, 4).map(a => `<li><a href="${link(base, lang, a)}">${esc(a.title)}</a></li>`).join('')}</ul>${list.length > 4 ? `<a class="more" href="${base}/search?q=&amp;cat=${encodeURIComponent(k)}&amp;lang=${lang}">${esc(h.more)} (${list.length})</a>` : ''}</section>`).join('')}</div>` : `<p class="m hc-empty">${esc(t.none)}</p>`;
  const pop = popular.length ? `<h2 class="hc-h">${esc(h.popular)}</h2><ul class="hc-pop">${popular.map(a => `<li><a href="${link(base, lang, a)}"><strong>${esc(a.title)}</strong><span class="m">${plainEx(a.excerpt)}</span></a></li>`).join('')}</ul>` : '';
  const cta = `<section class="hc-cta"><div><h2>${esc(h.contact)}</h2><p>${esc(h.contactSub)}</p></div><a class="btn" href="${base}/requests/new?lang=${lang}">${esc(h.submit)}</a></section>`;
  return layout({ org, lang, title: t.help, base, hero, wide: true, statusLink, body: `${grid}${pop}${langLinks(base, lang, '')}${cta}` });
}
export function searchPage({ org, lang, base, q, results, statusLink = false }) {
  const t = T[lang];
  return layout({ org, lang, title: t.search, base, statusLink, wide: true, body: `<div class="hc-narrow"><h1>${esc(t.help)}</h1>${searchBox(base, lang, q)}${results.length ? `<h2>${esc(t.results)} “${esc(q)}”</h2><ul class="hc-results">${results.map(a => `<li><a href="${link(base, lang, a)}"><strong>${esc(a.title)}</strong>${a.category ? `<span class="chip">${esc(a.category)}</span>` : ''}<span class="m">${plainEx(a.excerpt)}</span></a></li>`).join('')}</ul>` : `<p>${esc(t.noResults)} “${esc(q)}”.</p>`}<p><a href="${base}?lang=${lang}">${esc(t.backHelp)}</a></p></div>` });
}
export function articlePage({ org, lang, base, a, html, toc = [], related = [], translations, voted, statusLink = false }) {
  const t = T[a.lang] || T[lang], h = HT(a.lang);
  const crumbs = `<nav class="hc-crumbs" aria-label="Breadcrumb"><a href="${base}?lang=${a.lang}">${esc(h.crumbHome)}</a>${a.category ? `<span aria-hidden="true">›</span><span>${esc(a.category)}</span>` : ''}</nav>`;
  const tocHtml = toc.length > 1 ? `<aside class="hc-toc" aria-label="${esc(h.onPage)}"><strong>${esc(h.onPage)}</strong><ul>${toc.map(x => `<li class="l${x.level}"><a href="#${esc(x.id)}">${esc(x.text)}</a></li>`).join('')}</ul></aside>` : '';
  const rel = related.length ? `<section class="hc-related"><h2>${esc(h.related)}</h2><ul>${related.map(x => `<li><a href="${link(base, a.lang, x)}">${esc(x.title)}</a></li>`).join('')}</ul></section>` : '';
  const vote = voted ? `<p class="hc-vote">${esc(t.thanks)}</p>` : `<form method="post" action="${base}/a/${esc(a.slug)}/vote?lang=${a.lang}" class="hc-vote"><span>${esc(t.helpful)}</span> <button class="btn l" name="v" value="yes" type="submit">${esc(t.yes)}</button> <button class="btn l" name="v" value="no" type="submit">${esc(t.no)}</button></form>`;
  return layout({ org, lang: a.lang, title: a.title, base, statusLink, wide: true, body: `${crumbs}<div class="hc-art"><div class="hc-col">${searchBox(base, a.lang)}<article class="hc-article"><h1>${esc(a.title)}</h1><p class="m">${esc(t.updated)} ${esc(date(a.updated_at, a.lang))}</p>${html}</article>${translations.length ? `<p class="m">${esc(t.otherLang)}: ${translations.map(x => `<a href="${base}/a/${esc(x.slug)}?lang=${x.lang}">${LANG_NAMES[x.lang]}</a>`).join(' · ')}</p>` : ''}${vote}${rel}</div>${tocHtml}</div>` });
}
export function signinPage({ org, lang, base, sent, bad }) {
  const t = T[lang];
  return layout({ org, lang, title: t.myTickets, base, body: `<h1>${esc(t.signin)}</h1>${sent ? `<p class="msg" role="status">${esc(t.checkEmail)}</p>` : ''}${bad ? `<p class="msg err" role="alert">${esc(t.badLink)}</p>` : ''}<form method="post" action="${base}/tickets/login?lang=${lang}" class="f"><label for="e">${esc(t.email)}</label><input id="e" name="email" type="email" required maxlength="254" autocomplete="email"><button class="btn" type="submit">${esc(t.sendLink)}</button></form>` });
}
export const confirmPage = ({ org, lang, base, token }) => layout({ org, lang, title: T[lang].confirmIn, base, body: `<h1>${esc(T[lang].confirmIn)}</h1><form method="post" action="${base}/tickets/verify?lang=${lang}" class="f"><input type="hidden" name="t" value="${esc(token)}"><button class="btn" type="submit">${esc(T[lang].continue)}</button></form>` });
export function ticketsPage({ org, lang, base, email, tickets }) {
  const t = T[lang];
  return layout({ org, lang, title: t.requests, base, signedIn: true, body: `<h1>${esc(t.requests)}</h1><p class="m">${esc(email)}</p>${tickets.length ? `<ul class="list">${tickets.map(x => `<li><a href="${base}/tickets/${x.number}?lang=${lang}">#${x.number} ${esc(x.subject)}</a><span class="m">${esc(t.status[x.status] || x.status)} · ${esc(date(x.updated_at, lang))}</span></li>`).join('')}</ul>` : `<p class="m">${esc(t.noRequests)}</p>`}` });
}
export function ticketPage({ org, lang, base, data, csrf, note, bad }) {
  const t = T[lang], k = data.ticket;
  return layout({ org, lang, title: `#${k.number} ${k.subject}`, base, signedIn: true, body: `<p><a href="${base}/tickets?lang=${lang}">← ${esc(t.back)}</a></p><h1>#${k.number} ${esc(k.subject)}</h1><p class="m">${esc(t.status[k.status] || k.status)}</p>${note ? `<p class="msg${bad ? ' err' : ''}" role="status">${esc(note)}</p>` : ''}${data.messages.map(m => `<div class="msg-b ${m.kind}"><div class="m">${esc(m.kind === 'requester' ? t.youSaid : m.author_name)} · ${esc(date(m.created_at, lang))}</div><div>${fmtHtml(m.body)}</div>${m.files.length ? `<div class="m">${esc(t.files)}: ${m.files.map(f => esc(f.filename)).join(', ')}</div>` : ''}</div>`).join('')}${k.status === 'closed' ? `<p class="m">${esc(t.closedNote)}</p>` : `<form method="post" action="${base}/tickets/${k.number}/reply?lang=${lang}" class="f wide"><input type="hidden" name="csrf" value="${esc(csrf)}"><label for="b">${esc(t.reply)}</label><textarea id="b" name="body" required maxlength="20000" rows="6"></textarea><button class="btn" type="submit">${esc(t.send)}</button></form>`}` });
}
export const notFoundPage = ({ org, lang, base }) => layout({ org, lang, title: T[lang].notFound, base, body: `<h1>${esc(T[lang].notFound)}</h1><p><a href="${base}?lang=${lang}">${esc(T[lang].backHelp)}</a></p>` });

// the rating page (opened from the survey email): good or bad, a comment, one button. Nothing is recorded until the button is pressed.
const CS = { en: { title: 'How did we do?', good: 'Good, I am happy with the support', bad: 'Bad, I am not happy', comment: 'Anything to add? (optional)', send: 'Send my rating', thanks: 'Thank you for your feedback.', again: 'You can change your rating by opening the link in the email again.' }, es: { title: '¿Cómo lo hicimos?', good: 'Bien, estoy satisfecho con la atención', bad: 'Mal, no estoy satisfecho', comment: '¿Algo que añadir? (opcional)', send: 'Enviar mi valoración', thanks: 'Gracias por tus comentarios.', again: 'Puedes cambiar tu valoración abriendo de nuevo el enlace del correo.' } };
export const csatPage = ({ org, lang, base, number, token, pre, done }) => { const c = CS[lang] || CS.en; return layout({ org, lang, title: c.title, base, body: done ? `<h1>${esc(c.thanks)}</h1><p class="m">${esc(c.again)}</p>` : `<h1>${esc(c.title)}</h1><p class="m">#${esc(number)}</p><form method="post" action="${base}/csat/${esc(number)}?lang=${lang}"><input type="hidden" name="t" value="${esc(token)}"><p><label><input type="radio" name="r" value="good"${pre === 'good' ? ' checked' : ''} required> ${esc(c.good)}</label></p><p><label><input type="radio" name="r" value="bad"${pre === 'bad' ? ' checked' : ''}> ${esc(c.bad)}</label></p><p><label>${esc(c.comment)}<br><textarea name="comment" rows="4" maxlength="1000" style="width:100%"></textarea></label></p><p><button class="btn" type="submit">${esc(c.send)}</button></p></form>` }); };

// ---- request forms ----
const RQ = {
  en: { title: 'Submit a request', pick: 'What do you need help with?', email: 'Your email', name: 'Your name (optional)', subject: 'Subject', desc: 'How can we help?', send: 'Send request', thanks: 'Request received', got: 'We got your request. Your reference number is', follow: 'We will reply by email. To follow it online, sign in with your email address.', follow2: 'Follow your request', back: 'Back to the help center', before: 'Look for an answer first', optional: '(optional)', yes: 'Yes', hint: 'Short summary' },
  es: { title: 'Enviar una solicitud', pick: '¿Con qué necesitas ayuda?', email: 'Tu correo', name: 'Tu nombre (opcional)', subject: 'Asunto', desc: '¿Cómo podemos ayudarte?', send: 'Enviar solicitud', thanks: 'Solicitud recibida', got: 'Recibimos tu solicitud. Tu número de referencia es', follow: 'Te responderemos por correo. Para seguirla en línea, inicia sesión con tu correo.', follow2: 'Seguir tu solicitud', back: 'Volver al centro de ayuda', before: 'Busca primero una respuesta', optional: '(opcional)', yes: 'Sí', hint: 'Resumen corto' },
};
const fieldInput = (f, v, lang) => {
  const id = 'cf_' + esc(f.key), val = v == null ? '' : v;
  if (f.type === 'dropdown') return `<label for="${id}">${esc(f.label)}</label><select id="${id}" name="${id}"><option value=""></option>${(f.options || []).map(o => `<option${String(val) === o ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  if (f.type === 'checkbox') return `<label class="chk"><input type="checkbox" id="${id}" name="${id}"${val === 'on' ? ' checked' : ''}> ${esc(f.label)}</label>`;
  return `<label for="${id}">${esc(f.label)}</label><input id="${id}" name="${id}" type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}" value="${esc(val)}" maxlength="500">`;
};
export function requestPage({ org, lang, base, forms, form, token, values = {}, error = '', field = '' }) {
  const t = RQ[lang] || RQ.en, v = values, pick = forms.length ? `<form method="get" action="${base}/requests/new" class="f"><input type="hidden" name="lang" value="${lang}"><label for="form">${esc(t.pick)}</label><select id="form" name="form"><option value="">${esc(t.title)}</option>${forms.map(f => `<option value="${f.id}"${form && form.id === f.id ? ' selected' : ''}>${esc(f.name)}</option>`).join('')}</select><button class="btn l" type="submit">OK</button></form>` : '';
  const err = error ? `<p class="msg err" role="alert">${esc(error)}</p>` : '';
  const extra = form ? (form.fields || []).map(f => fieldInput(f, v['cf_' + f.key], lang)).join('') : '';
  return layout({ org, lang, title: t.title, base, body: `<h1>${esc(t.title)}</h1>${form && form.description ? `<p class="m">${esc(form.description)}</p>` : ''}${pick}<p class="m"><a href="${base}?lang=${lang}">${esc(t.before)}</a></p>${err}
<form method="post" action="${base}/requests/new?lang=${lang}" class="f req">
<input type="hidden" name="ts" value="${esc(token)}"><input type="hidden" name="form" value="${form ? form.id : ''}">
<div class="hp" aria-hidden="true" style="position:absolute;left:-9999px"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
<label for="email">${esc(t.email)}</label><input id="email" name="email" type="email" required maxlength="254" autocomplete="email" value="${esc(v.email)}"${field === 'email' ? ' autofocus' : ''}>
<label for="name">${esc(t.name)}</label><input id="name" name="name" maxlength="100" autocomplete="name" value="${esc(v.name)}">
<label for="subject">${esc(t.subject)}</label><input id="subject" name="subject" required maxlength="200" placeholder="${esc(form ? form.subject_hint : '')}" value="${esc(v.subject)}">
${extra}<label for="description">${esc(t.desc)}</label><textarea id="description" name="description" required rows="8" maxlength="5000">${esc(v.description)}</textarea>
<button class="btn" type="submit">${esc(t.send)}</button></form>` });
}
export function requestDonePage({ org, lang, base, number }) {
  const t = RQ[lang] || RQ.en;
  return layout({ org, lang, title: t.thanks, base, body: `<h1>${esc(t.thanks)}</h1><p>${esc(t.got)} <strong>#${Number(number)}</strong>.</p><p class="m">${esc(t.follow)}</p><p><a class="btn" href="${base}/tickets?lang=${lang}">${esc(t.follow2)}</a> <a class="btn l" href="${base}?lang=${lang}">${esc(t.back)}</a></p>` });
}
export const requestLink = (base, lang) => `<p><a class="btn l" href="${base}/requests/new?lang=${lang}">${esc((RQ[lang] || RQ.en).title)}</a></p>`;
