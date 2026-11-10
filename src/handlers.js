// src/handlers.js: THE API, as plain functions of (Request, deps) → Response, so the tests can call them without Netlify. The files in netlify/functions only wire these to addresses.
import crypto from 'node:crypto';
import { PRODUCT, platformAdmins } from './config.js';
import { signupContext } from './auth.js';
import { getEntitlements, seatsUsed, checkoutConfig, verifySignature, applyPaddleEvent } from './billing.js';
import { grantLicense, revokeLicense } from './license.js';
import { withOrg } from './db.js';
import { getMailSettings, saveMailSettings, sendTicketReply, handleInbound, verifySvix, parseAddress } from './ticket-mail.js';
import { saveUpload, claimUploads, filesOfMessage, readFile, deleteFile, storeInbound, MAX_UPLOAD, cleanName } from './attachments.js';
import { orgBySlug, listArticles, getArticle, saveArticle, deleteArticle, publishedList, publicArticle, countView, vote as voteArticle, searchArticles, renderBody, LANGS } from './help.js';
import { COOKIE, SESSION_SECONDS, sessionCookie, readSession, csrfFor, csrfOk, requestLink, consumeLink, myTickets, myTicket, myReply } from './portal.js';
import * as pages from './help-pages.js';
import { importMdv } from './importer.js';
import { slugStatus, holdSlug, pendingOf, createWorkspace, changePending, cleanCompany, normalizeSlug } from './onboarding.js';
import { validAvatar } from './avatar.js';
import { createTicket, listTickets, getTicket, addMessage, updateTicket, listAgents } from './tickets.js';
import * as desk from './desk.js';
import { getSla, saveSla, slaOf } from './sla.js';
import { report as buildReport, reportCsv } from './reports.js';
import { dashboard } from './dashboard.js';
import { listHooks, saveHook, deleteHook, emit as emitHook } from './webhooks.js';
import { listRules, saveRule, deleteRule, runTriggers } from './triggers.js';
import { mentionedIds } from './mentions.js';
import { notifyTicket } from './notify.js';
import { themeById, usableTheme } from './themes.js';
import { PLANS, has as planHas } from './plans.js';

const json = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(extra || {}) } });
const readJson = async (req, max = 10000) => { try { const t = await req.text(); if (t.length > max) return null; const v = JSON.parse(t || '{}'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const session = async (auth, req) => { try { return await auth.api.getSession({ headers: req.headers }); } catch { return null; } };
const roleIn = async (pool, userId, orgId) => (await pool.query('select role from member where "userId" = $1 and "organizationId" = $2', [userId, orgId])).rows[0]?.role || '';
const audit = (pool, orgId, actorId, action, target, meta) => withOrg(pool, orgId, c => c.query('insert into audit_log (org_id, actor_id, action, target, meta) values ($1,$2,$3,$4,$5)', [orgId, actorId, action, target || null, JSON.stringify(meta || {})]));

// who am I, which organizations am I in, and what each one may do
export async function me(req, { pool, auth }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const orgs = (await pool.query(`select o.id, o.name, o.slug, m.role from member m join "organization" o on o.id = m."organizationId" where m."userId" = $1 order by o.name`, [s.user.id])).rows;
  const out = [];
  for (const o of orgs) { const ent = await getEntitlements(pool, o.id), used = await seatsUsed(pool, o.id); out.push({ ...o, plan: ent.plan, license: ent.license, seats: ent.seats === Infinity ? null : ent.seats, seatsUsed: used, features: [...ent.features] }); }
  const pend = await pendingOf(pool, s.user.id);
  return json(200, { user: { id: s.user.id, email: s.user.email, name: s.user.name, twoFactor: !!s.user.twoFactorEnabled, emailVerified: !!s.user.emailVerified }, organizations: out, pendingWorkspace: pend });
}

// the plan an owner or admin picked → the details the Paddle checkout needs
export async function checkout(req, { pool, auth, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const b = await readJson(req); if (!b) return json(400, { error: 'That request could not be read.' });
  const orgId = String(b.orgId || ''), role = await roleIn(pool, s.user.id, orgId);
  if (role !== 'owner' && role !== 'admin') return json(403, { error: 'Only an owner or an admin can change the plan.' });
  const used = await seatsUsed(pool, orgId), c = checkoutConfig({ orgId, plan: b.plan, interval: b.interval, seats: b.seats }, env);
  if (c.error) return json(400, { error: c.error });
  if (c.quantity < used) return json(400, { error: `You already have ${used} agents or invitations. Choose at least ${used} seats, or remove people first.` });
  return json(200, { ...c, customerEmail: s.user.email, clientToken: env.PADDLE_CLIENT_TOKEN || '', sandbox: env.PADDLE_ENV !== 'production' });
}

// the platform owner grants or takes back a lifetime licence (for example for mdv)
export async function license(req, { pool, auth }) {
  if (req.method !== 'POST' && req.method !== 'DELETE') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified || !platformAdmins().includes(String(s.user.email).toLowerCase())) return json(403, { error: 'Only the platform owner can do that.' });
  const b = await readJson(req); if (!b) return json(400, { error: 'That request could not be read.' });
  let orgId = String(b.orgId || ''); if (!orgId && b.slug) orgId = (await pool.query('select id from "organization" where slug = $1', [String(b.slug)])).rows[0]?.id || '';
  if (!orgId) return json(404, { error: 'No such organization.' });
  const r = req.method === 'POST' ? await grantLicense(pool, { orgId, actorEmail: s.user.email, note: b.note }) : await revokeLicense(pool, { orgId });
  if (!r.ok) return json(404, { error: r.error || 'There was no licence to remove.' });
  await audit(pool, orgId, s.user.id, req.method === 'POST' ? 'license-granted' : 'license-revoked', orgId, { by: s.user.email });
  return json(200, { ok: true });
}

// Paddle's events. The body is read as text first (the signature covers the exact bytes), then checked, then applied.
export async function paddleWebhook(req, { pool, env = process.env, now = Date.now() }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text();
  if (raw.length > 200000) return json(413, { error: 'Too large.' });
  if (!verifySignature(raw, req.headers.get('paddle-signature'), env.PADDLE_WEBHOOK_SECRET, now)) return json(401, { error: 'Bad signature.' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: 'Not JSON.' }); }
  const r = await applyPaddleEvent(pool, ev, env);
  if (!r.ok) { console.warn('paddle event not applied:', r.why, ev && ev.event_id); return json(r.why === 'malformed' ? 400 : 200, { ok: false, why: r.why }); }          // an event we cannot use is acknowledged (200) so Paddle does not retry it forever
  if (r.orgId && r.why === 'applied') await audit(pool, r.orgId, null, 'plan-changed', r.orgId, { plan: r.plan, seats: r.seats, status: r.status });
  return json(200, { ok: true, why: r.why });
}

// the agent desk: ONE door, POST {orgId, action, ...}. Every member of the organization may work tickets; the organization is checked on every call.
export async function tickets(req, { pool, auth, mailer, store, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const b = await readJson(req, 60000); if (!b) return json(400, { error: 'That request could not be read.' });
  const orgId = String(b.orgId || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  const actor = { id: s.user.id, name: s.user.name, email: s.user.email };
  const isAdmin = role === 'owner' || role === 'admin', ent = await getEntitlements(pool, orgId);
  // a feature of a higher plan: refuse with the name of the plan that has it
  const need = f => planHas(ent, f) ? null : json(402, { error: `This is part of the ${PLANS[Object.keys(PLANS).find(k => PLANS[k].features.includes(f))].name} plan. Upgrade to use it.`, upgrade: true });
  const adminOnly = () => isAdmin ? null : json(403, { error: 'Only an owner or an admin can change this.' });
  let r, g;
  switch (b.action) {
    case 'init': {
      const [agents, labels, queues, clients, macros, views] = await Promise.all([listAgents(pool, orgId), desk.labelsInUse(pool, orgId), planHas(ent, 'queues') ? desk.listQueues(pool, orgId) : { queues: [] }, planHas(ent, 'clients') ? desk.listClients(pool, orgId) : { clients: [] }, desk.listMacros(pool, orgId), planHas(ent, 'saved_views') ? desk.listViews(pool, orgId, actor) : { views: [] }]);
      const pref = (await pool.query('select theme, notify, avatar from desk_prefs where user_id = $1', [actor.id])).rows[0], theme = usableTheme(pref?.theme, planHas(ent, 'themes'));
      r = { ok: true, theme, avatar: pref ? pref.avatar : null, notify: pref ? pref.notify : true, sla: planHas(ent, 'sla') ? (await getSla(pool, orgId)).policies : null, agents, labels: labels.labels, queues: queues.queues, clients: clients.clients, macros: macros.macros, views: views.views, features: [...ent.features], plan: ent.plan, admin: isAdmin }; break;
    }
    case 'prefs-save': {
      const th = b.theme === undefined ? null : themeById(String(b.theme || '')); if (b.theme !== undefined && !th) return json(400, { error: 'That theme does not exist.' });
      if (th && th.premium && (g = need('themes'))) return g;
      const setAv = b.avatar !== undefined, av = setAv && b.avatar ? String(b.avatar) : null;
      if (setAv && av && !validAvatar(av)) return json(400, { error: 'Use a PNG, JPEG or WebP picture under 60 KB.' });
      if (b.theme === undefined && typeof b.notify !== 'boolean' && !setAv) return json(400, { error: 'Nothing to save.' });
      await pool.query('insert into desk_prefs (user_id, theme, notify, avatar) values ($1, coalesce($2, \'classic\'), coalesce($3, true), $5) on conflict (user_id) do update set theme = coalesce($2, desk_prefs.theme), notify = coalesce($3, desk_prefs.notify), avatar = case when $4 then $5 else desk_prefs.avatar end, updated_at = now()', [actor.id, th ? th.id : null, typeof b.notify === 'boolean' ? b.notify : null, setAv, av]);
      r = { ok: true, ...(th ? { theme: th.id } : {}), ...(typeof b.notify === 'boolean' ? { notify: b.notify } : {}), ...(setAv ? { avatar: av } : {}) }; break;
    }
    case 'rules-list': if ((g = adminOnly() || need('triggers'))) return g; r = await listRules(pool, orgId); break;
    case 'rule-save': if ((g = adminOnly() || need('triggers'))) return g; r = await saveRule(pool, orgId, b); break;
    case 'rule-delete': if ((g = adminOnly() || need('triggers'))) return g; if (!(await deleteRule(pool, orgId, b.id))) return json(404, { error: 'No such rule.' }); r = { ok: true }; break;
    case 'webhooks-list': if ((g = adminOnly() || need('integrations'))) return g; r = await listHooks(pool, orgId); break;
    case 'webhook-save': if ((g = adminOnly() || need('integrations'))) return g; r = await saveHook(pool, orgId, b); break;
    case 'webhook-delete': if ((g = adminOnly() || need('integrations'))) return g; if (!(await deleteHook(pool, orgId, b.id))) return json(404, { error: 'No such webhook.' }); r = { ok: true }; break;
    case 'dashboard': r = await dashboard(pool, orgId, actor, { portalDomain: String(env.PORTAL_DOMAIN || '').toLowerCase(), sla: planHas(ent, 'sla'), agents: (await listAgents(pool, orgId)).length }); break;
    case 'sla-get': if ((g = need('sla'))) return g; r = await getSla(pool, orgId); break;
    case 'sla-save': if ((g = adminOnly() || need('sla'))) return g; r = await saveSla(pool, orgId, b.policies); break;
    case 'report': if ((g = need('reports'))) return g; r = await buildReport(pool, orgId, b.days); break;
    case 'report-csv': if ((g = need('reports'))) return g; r = await reportCsv(pool, orgId, b.days); break;
    case 'list': {
      if (!planHas(ent, 'sla')) b.sla = undefined;
      r = await listTickets(pool, orgId, actor, b);
      if (r.ok && planHas(ent, 'sla')) { const pol = (await getSla(pool, orgId)).policies; r.tickets = r.tickets.map(t => ({ ...t, sla: slaOf(t, pol) })); }
      break;
    }
    case 'get': {
      r = await getTicket(pool, orgId, actor, b.number);
      if (r.ok) Object.assign(r, { extras: await desk.extras(pool, orgId, actor, r.ticket) });
      if (r.ok && planHas(ent, 'sla')) r.ticket = { ...r.ticket, sla: slaOf(r.ticket, (await getSla(pool, orgId)).policies) };
      break;
    }
    case 'queue-save': if ((g = adminOnly() || need('queues'))) return g; r = await desk.saveQueue(pool, orgId, b); break;
    case 'queue-delete': if ((g = adminOnly() || need('queues'))) return g; r = await desk.deleteQueue(pool, orgId, b.id); break;
    case 'labels': r = await desk.labelsInUse(pool, orgId); break;
    case 'follow': r = await desk.follow(pool, orgId, actor, b.number, b.on !== false); break;
    case 'merge': r = await desk.mergeTickets(pool, orgId, actor, b.number, b.into); break;
    case 'edit-message': r = await desk.editMessage(pool, orgId, actor, b.number, b.messageId, b.body); break;
    case 'client-save': if ((g = adminOnly() || need('clients'))) return g; r = await desk.saveClient(pool, orgId, actor, b); break;
    case 'client-delete': if ((g = adminOnly() || need('clients'))) return g; r = await desk.deleteClient(pool, orgId, b.id); break;
    case 'client-notes': if ((g = need('clients'))) return g; r = await desk.saveClientNotes(pool, orgId, b.id, b.notes); break;
    case 'macro-save': if ((g = adminOnly())) return g; r = await desk.saveMacro(pool, orgId, b); break;
    case 'macro-delete': if ((g = adminOnly())) return g; r = await desk.deleteMacro(pool, orgId, b.id); break;
    case 'view-save': if ((g = need('saved_views'))) return g; if (b.shared === true && (g = adminOnly())) return g; r = await desk.saveView(pool, orgId, actor, b); break;
    case 'view-delete': if ((g = need('saved_views'))) return g; r = await desk.deleteView(pool, orgId, actor, b.id, isAdmin); break;
    case 'link': if ((g = need('linked_tickets'))) return g; r = await desk.linkIncident(pool, orgId, actor, b.number, b.problem); break;
    case 'unlink': if ((g = need('linked_tickets'))) return g; r = await desk.unlinkIncident(pool, orgId, actor, b.number); break;
    case 'problem-resolve': if ((g = need('linked_tickets'))) return g; r = await desk.resolveProblem(pool, orgId, actor, b.number); break;
    case 'side-send': if ((g = need('side_conversations'))) return g; r = mailer ? await desk.sendSide(pool, mailer, env, orgId, actor, b.number, b) : { ok: false, status: 503, error: 'Email is not set up.' }; break;
    case 'side-close': if ((g = need('side_conversations'))) return g; r = await desk.closeSide(pool, orgId, actor, b.number, b.sideId); break;
    case 'create': r = await createTicket(pool, orgId, actor, b); if (r.ok) { if (planHas(ent, 'triggers')) await runTriggers(pool, mailer, env, orgId, 'created', r.ticket.number, String(b.body || '')); await emitHook(pool, orgId, 'ticket.created', r.ticket.number); } break;
    case 'reply': {
      r = await addMessage(pool, orgId, actor, b.number, { body: b.body, internal: false, status: b.status });
      if (r.ok && store && Array.isArray(b.attachmentIds) && b.attachmentIds.length) await claimUploads(pool, orgId, actor, b.number, r.message.id, b.attachmentIds);
      if (r.ok && mailer) {
        const rows = store ? await filesOfMessage(pool, orgId, r.message.id) : [], files = [];
        for (const f of rows) { const x = await readFile(pool, store, orgId, f.id); if (x) files.push(x); }
        const d = await sendTicketReply(pool, mailer, env, orgId, Number(b.number), r.message.id, files); r.email = d.delivery; r.emailWhy = d.why;
      }
      if (r.ok) await emitHook(pool, orgId, 'message.agent', b.number, { message: { author: actor.name || actor.email, body: String(b.body || '').slice(0, 2000) } });
      break;
    }
    case 'delete-file': if (!store || !(await deleteFile(pool, store, orgId, b.id))) return json(404, { error: 'No such file.' }); r = { ok: true }; break;
    case 'article-list': r = await listArticles(pool, orgId); break;
    case 'article-get': r = await getArticle(pool, orgId, b.id); break;
    case 'article-save': r = await saveArticle(pool, orgId, actor, b); break;
    case 'article-delete': if (!(await deleteArticle(pool, orgId, b.id))) return json(404, { error: 'No such article.' }); r = { ok: true }; break;
    case 'mail-get': r = await getMailSettings(pool, orgId, env); break;
    case 'mail-save': if (role !== 'owner' && role !== 'admin') return json(403, { error: 'Only an owner or an admin can change the email settings.' }); r = await saveMailSettings(pool, orgId, b, env); break;
    case 'note': {
      r = await addMessage(pool, orgId, actor, b.number, { body: b.body, internal: true });
      if (r.ok) {
        const ids = (await mentionedIds(pool, orgId, b.body)).filter(i => i !== actor.id);
        for (const id of ids) await notifyTicket(pool, mailer, orgId, b.number, { kind: 'mention', onlyUserId: id, actorId: actor.id, summary: `${actor.name || actor.email}: ${String(b.body).slice(0, 250)}` });
        if (ids.length) await emitHook(pool, orgId, 'ticket.mentioned', b.number, { mentioned: ids, by: actor.name || actor.email });
        r.mentioned = ids.length;
      }
      break;
    }
    case 'update': {
      const pt = b.patch || {}; if (pt.queueId !== undefined && (g = need('queues'))) return g; if (pt.clientId !== undefined && (g = need('clients'))) return g;
      const was = pt.assigneeId ? (await pool.query('select assignee_id from tickets where org_id = $1 and number = $2', [orgId, Number(b.number) || 0])).rows[0]?.assignee_id : null;
      r = await updateTicket(pool, orgId, actor, b.number, pt);
      if (r.ok) await emitHook(pool, orgId, 'ticket.updated', b.number, { changes: Object.keys(pt) });
      if (r.ok && pt.assigneeId && pt.assigneeId !== was && pt.assigneeId !== actor.id) await notifyTicket(pool, mailer, orgId, b.number, { kind: 'assigned', onlyUserId: String(pt.assigneeId), actorId: actor.id, summary: `${actor.name || actor.email} assigned it to you.` });
      break;
    }
    case 'agents': r = { ok: true, agents: await listAgents(pool, orgId) }; break;
    default: return json(400, { error: 'Unknown action.' });
  }
  return r.ok ? json(200, r) : json(r.status || 400, { error: r.error });
}

// customers' email, posted by Resend (event email.received). The signature is checked on the exact bytes, the full message is fetched with our key, and anything we cannot use is acknowledged so it is not retried forever.
export async function inboundEmail(req, { pool, store, mailer, env = process.env, fetchFn = fetch, now = Date.now() }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text(); if (raw.length > 100000) return json(413, { error: 'Too large.' });
  if (!verifySvix(raw, req.headers, env.RESEND_WEBHOOK_SECRET, now)) return json(401, { error: 'Bad signature.' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: 'Not JSON.' }); }
  if (!ev || ev.type !== 'email.received' || !ev.data || !ev.data.email_id) return json(200, { ok: true, ignored: true });
  const evId = req.headers.get('svix-id');
  if ((await pool.query("select 1 from webhook_events where id = $1 and provider = 'resend'", [evId])).rowCount) return json(200, { ok: true, duplicate: true });
  let full;
  try {
    const r = await fetchFn(`https://api.resend.com/emails/receiving/${encodeURIComponent(ev.data.email_id)}`, { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    if (!r.ok) throw new Error('status ' + r.status); full = await r.json();
  } catch (e) { console.warn('could not fetch the received email:', e.message); return json(502, { error: 'Could not fetch the message.' }); }
  const res = await handleInbound(pool, env, { from: full.from || ev.data.from, to: full.to || ev.data.to, receivedFor: full.received_for || ev.data.received_for, messageId: full.message_id || ev.data.message_id, subject: full.subject || ev.data.subject, text: full.text, html: full.html, headers: full.headers, authentication: full.authentication, attachments: full.attachments || ev.data.attachments });
  if (res.ok && res.messageRowId && store && (full.attachments || ev.data.attachments || []).length) await storeInbound(pool, store, fetchFn, env, res.orgId, res.number, res.messageRowId, ev.data.email_id);
  await pool.query("insert into webhook_events (id, provider, type) values ($1,'resend','email.received') on conflict do nothing", [evId]);
  if (res.ok && (res.action === 'created' || res.action === 'followup')) { await maybeTriggers(pool, mailer, env, res.orgId, 'created', res.number, res.summary || ''); await emitHook(pool, res.orgId, 'ticket.created', res.number); }
  if (res.ok && res.action === 'replied') await maybeTriggers(pool, mailer, env, res.orgId, 'customer_reply', res.number, res.summary || '');
  if (res.ok && res.action === 'replied') await emitHook(pool, res.orgId, 'message.customer', res.number, { message: { body: String(res.summary || '').slice(0, 2000) } });
  if (res.ok && (res.action === 'replied' || res.action === 'side-replied')) await notifyTicket(pool, mailer, res.orgId, res.number, { kind: res.action === 'side-replied' ? 'side' : 'reply', summary: res.summary });
  if (res.dropped) console.log('inbound email dropped:', res.dropped);
  return json(200, { ok: true, ...(res.dropped ? { dropped: res.dropped } : { action: res.action, number: res.number }) });
}

// an agent uploads one file: POST the raw bytes to /api/attachments?org=…&name=…&type=…&ticket=…  (up to 5 MB; it waits unattached until a reply claims it)
export async function attachmentUpload(req, { pool, auth, store }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const u = new URL(req.url), orgId = String(u.searchParams.get('org') || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  if (Number(req.headers.get('content-length') || 0) > MAX_UPLOAD + 1024) return json(413, { error: 'Files can be up to 5 MB each.' });
  const bytes = Buffer.from(await req.arrayBuffer());
  const r = await saveUpload(pool, store, orgId, { id: s.user.id }, { filename: u.searchParams.get('name'), contentType: u.searchParams.get('type') || req.headers.get('content-type'), bytes, ticketNumber: u.searchParams.get('ticket') });
  return r.ok ? json(200, r) : json(r.status || 400, { error: r.error });
}
// a file is always downloaded, never shown inside our pages, and the browser may not guess its type
export async function attachmentDownload(req, { pool, auth, store }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const u = new URL(req.url), orgId = String(u.searchParams.get('org') || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  const f = await readFile(pool, store, orgId, u.pathname.split('/').pop()); if (!f) return json(404, { error: 'No such file.' });
  return new Response(f.bytes, { status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${cleanName(f.filename).replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(cleanName(f.filename))}`, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cache-Control': 'private, no-store', 'Content-Length': String(f.bytes.length) } });
}

// THE PUBLIC HELP CENTER AND CUSTOMER PORTAL: /help/<organization>/… (server-rendered pages, no script)
const html = (status, body, extra) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Accept-Language', ...(extra || {}) } });
const redirect = (to, extra) => new Response(null, { status: 303, headers: { Location: to, 'Cache-Control': 'no-store', ...(extra || {}) } });
const cookieOf = (req, name) => { const m = String(req.headers.get('cookie') || '').split(/;\s*/).map(x => x.split('=')).find(x => x[0] === name); return m ? m.slice(1).join('=') : ''; };
const pickLang = (req, u) => { const q = u.searchParams.get('lang'); if (LANGS.includes(q)) return q; const a = String(req.headers.get('accept-language') || '').toLowerCase(); const best = a.split(',').map(x => x.trim().slice(0, 2)).find(x => LANGS.includes(x)); return best || 'en'; };
const maybeTriggers = async (pool, mailer, env, orgId, event, n, msg) => { if (planHas(await getEntitlements(pool, orgId), 'triggers')) await runTriggers(pool, mailer, env, orgId, event, n, msg); };
// A request that came through the portal worker (<slug>.effdesk.com) carries the public address and the shared secret; only then is that address trusted.
export function portalOrigin(req, env, slug) {
  const sec = env.PORTAL_PROXY_SECRET, got = req.headers.get('x-effdesk-secret'), pub = req.headers.get('x-effdesk-portal') || '';
  if (!sec || !got || got.length !== sec.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(sec))) return '';
  try { const u = new URL(pub); return u.protocol === 'https:' && u.hostname.split('.')[0] === slug && !u.port && u.pathname === '/' ? u.origin : ''; } catch { return ''; }
}
export async function helpCenter(req, { pool, mailer, env = process.env, now = Date.now() }) {
  const u = new URL(req.url), parts = u.pathname.replace(/^\/help\/?/, '').split('/').filter(Boolean).map(x => { try { return decodeURIComponent(x); } catch { return ''; } });
  const org = parts[0] ? await orgBySlug(pool, parts[0]) : null, lang = pickLang(req, u), post = req.method === 'POST';
  if (req.method !== 'GET' && !post) return json(405, { error: 'Method not allowed.' });
  if (!org) return html(404, pages.notFoundPage({ org: { name: 'Help center' }, lang, base: '/help' }));
  const base = `/help/${org.slug}`, rest = parts.slice(1), secure = u.protocol === 'https:', portal = portalOrigin(req, env, org.slug);
  const form = async () => { const t = await req.text(); if (t.length > 40000) return new URLSearchParams(); return new URLSearchParams(t); };
  if (post) { const o = req.headers.get('origin'); if (o && new URL(o).host !== u.host) return json(403, { error: 'Bad origin.' }); }
  const cookie = cookieOf(req, COOKIE), sess = readSession(env, cookie, org.id, now);
  const setCookie = v => `${COOKIE}=${v}; Path=/help; HttpOnly; SameSite=Lax; Max-Age=${v ? SESSION_SECONDS : 0}${secure ? '; Secure' : ''}`;
  const notFound = () => html(404, pages.notFoundPage({ org, lang, base }), {});
  // help center
  if (!rest.length && !post) return html(200, pages.homePage({ org, lang, base, articles: await publishedList(pool, org.id, lang) }));
  if (rest[0] === 'search' && !post) { const q = String(u.searchParams.get('q') || '').slice(0, 100); return html(200, pages.searchPage({ org, lang, base, q, results: await searchArticles(pool, org.id, q, lang) })); }
  if (rest[0] === 'a' && rest[1]) {
    const found = await publicArticle(pool, org.id, rest[1], lang); if (!found) return notFound();
    const a = found.article;
    if (post && rest[2] === 'vote') { const f = await form(); const seen = cookieOf(req, 'eff_hv').split('.').includes(a.id.slice(0, 8)); if (!seen && (f.get('v') === 'yes' || f.get('v') === 'no')) await voteArticle(pool, org.id, a.id, f.get('v') === 'yes'); return redirect(`${base}/a/${a.slug}?lang=${a.lang}&voted=1`, { 'Set-Cookie': `eff_hv=${[...cookieOf(req, 'eff_hv').split('.').filter(Boolean), a.id.slice(0, 8)].slice(-30).join('.')}; Path=/help; Max-Age=2592000; SameSite=Lax${secure ? '; Secure' : ''}` }); }
    if (post) return json(405, { error: 'Method not allowed.' });
    if (found.better) return redirect(`${base}/a/${found.better.slug}?lang=${found.better.lang}`);
    await countView(pool, org.id, a.id);
    return html(200, pages.articlePage({ org, lang, base, a, html: renderBody(a.body), translations: found.translations, voted: u.searchParams.get('voted') === '1' }));
  }
  // customer portal
  if (rest[0] === 'tickets') {
    if (!rest[1] && !post) return sess ? html(200, pages.ticketsPage({ org, lang, base, email: sess.email, tickets: await myTickets(pool, org.id, sess.email) })) : html(200, pages.signinPage({ org, lang, base, sent: false, bad: u.searchParams.get('bad') === '1' }));
    if (rest[1] === 'login' && post) {
      const f = await form(), link = await requestLink(pool, org.id, f.get('email'), now);
      if (link && mailer) { try { await mailer.portalLink(link.email, `${portal ? portal + '/tickets/verify?t=' : PRODUCT.appUrl + base + '/tickets/verify?t='}${encodeURIComponent(link.token)}&lang=${lang}`, org.name, lang); } catch (e) { console.warn('portal link not sent:', e.message); } }
      return html(200, pages.signinPage({ org, lang, base, sent: true, bad: false }));
    }
    if (rest[1] === 'verify') {
      if (!post) return html(200, pages.confirmPage({ org, lang, base, token: String(u.searchParams.get('t') || '').slice(0, 100) }));     // opening the link only shows a button: mail scanners that open links cannot use it up
      const email = await consumeLink(pool, org.id, (await form()).get('t')); if (!email) return redirect(`${base}/tickets?bad=1&lang=${lang}`);
      return redirect(`${base}/tickets?lang=${lang}`, { 'Set-Cookie': setCookie(sessionCookie(env, org.id, email, now)) });
    }
    if (rest[1] === 'logout' && post) return redirect(`${base}/tickets?lang=${lang}`, { 'Set-Cookie': setCookie('') });
    if (!sess) return redirect(`${base}/tickets?lang=${lang}`);
    const n = /^\d{1,9}$/.test(rest[1] || '') ? Number(rest[1]) : 0; if (!n) return notFound();
    if (!post) { const data = await myTicket(pool, org.id, sess.email, n); return data ? html(200, pages.ticketPage({ org, lang, base, data, csrf: csrfFor(env, cookie), note: u.searchParams.get('sent') ? pages.T[lang].sent : '' })) : notFound(); }
    if (rest[2] === 'reply') {
      const f = await form(); if (!csrfOk(env, cookie, f.get('csrf'))) return json(403, { error: 'Bad request.' });
      const body = String(f.get('body') || '').trim(); const data = await myTicket(pool, org.id, sess.email, n); if (!data) return notFound();
      if (!body) return html(400, pages.ticketPage({ org, lang, base, data, csrf: csrfFor(env, cookie), note: pages.T[lang].empty, bad: true }));
      const r = await myReply(pool, org.id, sess.email, n, body, '');
      if (r.ok) { await notifyTicket(pool, mailer, org.id, n, { kind: 'reply', summary: body }); await maybeTriggers(pool, mailer, env, org.id, 'customer_reply', n, body); await emitHook(pool, org.id, 'message.customer', n, { message: { body: body.slice(0, 2000) } }); }
      return r.ok ? redirect(`${base}/tickets/${n}?sent=1&lang=${lang}`) : notFound();
    }
  }
  return notFound();
}

// the platform owner moves the old desk's data in: POST { orgSlug, dryRun, data: { tickets, articles } }
export async function importData(req, { pool, auth }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified || !platformAdmins().includes(String(s.user.email).toLowerCase())) return json(403, { error: 'Only the platform owner can do that.' });
  const b = await readJson(req, 5500000); if (!b) return json(400, { error: 'That file could not be read, or it is too large (5 MB at a time).' });
  const org = await orgBySlug(pool, b.orgSlug); if (!org) return json(404, { error: 'No such organization.' });
  const r = await importMdv(pool, org.id, b.data, { dryRun: b.dryRun === true });
  if (!r.ok) return json(r.status || 400, { error: r.error });
  if (!r.dryRun) await audit(pool, org.id, s.user.id, 'data-imported', org.id, { tickets: r.tickets.added, articles: r.articles.added, by: s.user.email });
  return json(200, r);
}

// ---- registration and the first workspace ----
const hits = new Map();            // a light per-address limit for the public availability check (per function instance)
const tooMany = (ip, now, max = 40) => { const w = (hits.get(ip) || []).filter(t => now - t < 60000); w.push(now); hits.set(ip, w); if (hits.size > 5000) hits.clear(); return w.length > max; };
export async function workspaceCheck(req, { pool, now = Date.now() }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  if (tooMany(String(req.headers.get('x-forwarded-for') || 'x').split(',')[0].trim(), now)) return json(429, { error: 'Too many checks. Wait a minute.' });
  return json(200, await slugStatus(pool, new URL(req.url).searchParams.get('slug')));
}
// registration: checks the company and address, creates the account through Better Auth (so its limits and rules all apply), and holds the address for the person
export async function signup(req, { pool, auth }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const b = await readJson(req); if (!b) return json(400, { message: 'That request could not be read.' });
  const company = cleanCompany(b.company), st = await slugStatus(pool, b.slug);
  if (company.length < 2) return json(400, { message: 'Enter your company name.', code: 'COMPANY' });
  if (!st.available) return json(409, { message: st.reason, code: 'SLUG_TAKEN' });
  const headers = new Headers({ 'content-type': 'application/json' }); for (const h of ['x-forwarded-for', 'origin', 'referer', 'user-agent']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  const r = await signupContext.run({ company }, () => auth.handler(new Request(new URL('/api/auth/sign-up/email', req.url), { method: 'POST', headers, body: JSON.stringify({ name: b.name, email: b.email, password: b.password, callbackURL: '/welcome.html' }) })));
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const u = (await pool.query(`select id from "user" where lower(email) = $1 and "emailVerified" = false and "createdAt" > now() - interval '1 minute' and not exists (select 1 from pending_signups where user_id = "user".id)`, [String(b.email || '').trim().toLowerCase()])).rows[0];       // only an account created by THIS request: an existing address (Better Auth answers the same way, to avoid revealing it) must never get its pending workspace changed
  if (u && !(await holdSlug(pool, u.id, company, st.slug))) { await pool.query('delete from "user" where id = $1', [u.id]); return json(409, { message: 'That address was just taken. Choose another.', code: 'SLUG_TAKEN' }); }
  return json(200, { ok: true, slug: st.slug });
}
// after the confirmation link: create the workspace the person asked for (POST), or choose another address first (PATCH { slug })
export async function workspace(req, { pool, auth, env = process.env }) {
  if (req.method !== 'POST' && req.method !== 'PATCH') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified) return json(403, { error: 'Confirm your email address first.' });
  if (req.method === 'PATCH') { const b = await readJson(req); const r = b ? await changePending(pool, s.user.id, b.slug) : { ok: false, reason: 'Bad request.' }; return r.ok ? json(200, r) : json(409, { error: r.reason }); }
  const r = await createWorkspace(pool, auth, req.headers, s.user, env);
  return r.ok ? json(200, { ok: true, existing: r.existing, organization: r.org }) : json(r.status || 400, { error: r.error, taken: !!r.taken });
}
export const _json = json;
