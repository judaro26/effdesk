// src/handlers.js: THE API, as plain functions of (Request, deps) → Response, so the tests can call them without Netlify. The files in netlify/functions only wire these to addresses.
import crypto from 'node:crypto';
import { PRODUCT, platformAdmins } from './config.js';
import { signupContext } from './auth.js';
import { getEntitlements, seatsUsed, checkoutConfig, verifySignature, applyPaddleEvent } from './billing.js';
import { grantLicense, revokeLicense } from './license.js';
import { withOrg } from './db.js';
import { getMailSettings, saveMailSettings, sendTicketReply, handleInbound, verifySvix, parseAddress, isReceiptEvent, applyReceipt, emailDeliveryOf } from './ticket-mail.js';
import { saveUpload, claimUploads, filesOfMessage, readFile, deleteFile, storeInbound, MAX_UPLOAD, cleanName } from './attachments.js';
import { orgBySlug, listArticles, getArticle, saveArticle, deleteArticle, publishedList, publicArticle, countView, vote as voteArticle, searchArticles, renderBody, LANGS } from './help.js';
import { COOKIE, SESSION_SECONDS, sessionCookie, readSession, csrfFor, csrfOk, requestLink, consumeLink, myTickets, myTicket, myReply } from './portal.js';
import * as pages from './help-pages.js';
import { importMdv } from './importer.js';
import { printPage, eml as emlFile, pick as pickMessages } from './ticket-export.js';
import { suggestReply, summarize as aiSummarize, rewrite as aiRewrite, usage as aiUsage } from './ai.js';
import { source as migrationSource, Wait, Bad, PROVIDERS } from './migration-sources.js';
import { ownerWorkspaces, slugStatus, holdSlug, pendingOf, createWorkspace, changePending, cleanCompany, normalizeSlug } from './onboarding.js';
import { validAvatar } from './avatar.js';
import { createTicket, listTickets, getTicket, addMessage, updateTicket, listAgents } from './tickets.js';
import * as desk from './desk.js';
import { getSla, saveSla, slaOf, slaNumbers } from './sla.js';
import { getHours, saveHours, calendarOf } from './hours.js';
import { report as buildReport, reportCsv } from './reports.js';
import { dashboard } from './dashboard.js';
import { getSso, saveSso, deleteSso } from './sso.js';
import * as wa from './whatsapp.js';
import { recordBrowserError } from './errors.js';
import * as statusSvc from './status.js';
import * as adminActions from './admin-actions.js';
import { settings as platformSettings, publicBanner } from './platform-settings.js';
import { getSettings as chatSettings, saveSettings as saveChatSettings, chatOpen } from './chat.js';
import { listHooks, saveHook, deleteHook, emit as emitHook } from './webhooks.js';
import { listRules, saveRule, deleteRule, runTriggers } from './triggers.js';
import { surveyIfSolved, rate, tokenOk, csatOn, setCsatOn, ratingOf } from './csat.js';
import { listTokens, createToken, deleteToken, authenticate } from './api.js';
import { info as logInfo, annotate } from './log.js';
import { PERMS, permFor, customRoleOf, listRoles, saveRole, deleteRole, assignRole, clearAssignment } from './roles.js';
import { listAudit, auditCsv, exportInfo, exportData, ticketsCsv } from './audit.js';
import { getRouting, saveRouting, setAvailable, myAvailability } from './routing.js';
import { heartbeat, leave as leavePresence, newSince, recentDuplicate } from './presence.js';
import { listForms, saveForm, deleteForm, publicForms, submit as submitRequest, newToken as requestToken } from './requests.js';
import { agentDetail, listTeam, changeRole, removeMember, cancelInvite, resendInvite } from './team.js';
import { customers as platformCustomers, csv as customersCsv } from './platform.js';
import { SUPPORT_READ, recentEntries, customerDetail, countApiCall } from './support.js';
import { listFields, saveField, deleteField } from './fields.js';
import { mentionedIds } from './mentions.js';
import { notifyTicket } from './notify.js';
import { themeById, usableTheme } from './themes.js';
import { PLANS, has as planHas } from './plans.js';

const json = (status, body, extra) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(extra || {}) } });
const readJson = async (req, max = 10000) => { try { const t = await req.text(); if (t.length > max) return null; const v = JSON.parse(t || '{}'); return v && typeof v === 'object' ? v : null; } catch { return null; } };
const session = async (auth, req) => { try { return await auth.api.getSession({ headers: req.headers }); } catch { return null; } };
const roleIn = async (pool, userId, orgId) => (await pool.query('select role from member where "userId" = $1 and "organizationId" = $2', [userId, orgId])).rows[0]?.role || '';
const audit = (pool, orgId, actorId, action, target, meta) => { logInfo('audit', { org: orgId, actor: actorId, action, target }); return auditWrite(pool, orgId, actorId, action, target, meta); };
const auditWrite = (pool, orgId, actorId, action, target, meta) => withOrg(pool, orgId, c => c.query('insert into audit_log (org_id, actor_id, action, target, meta) values ($1,$2,$3,$4,$5)', [orgId, actorId, action, target || null, JSON.stringify(meta || {})]));

// who am I, which organizations am I in, and what each one may do
export async function me(req, { pool, auth, env = process.env }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const orgs = (await pool.query(`select o.id, o.name, o.slug, m.role from member m join "organization" o on o.id = m."organizationId" where m."userId" = $1 order by o.name`, [s.user.id])).rows;
  const out = [];
  for (const o of orgs) { const ent = await getEntitlements(pool, o.id), used = await seatsUsed(pool, o.id); out.push({ ...o, suspended: ent.suspended ? ent.suspendedReason || true : undefined, plan: ent.plan, license: ent.license, seats: ent.seats === Infinity ? null : ent.seats, seatsUsed: used, features: [...ent.features] }); }
  const pend0 = await pendingOf(pool, s.user.id), pend = pend0 && { ...pend0, ownerWorkspace: ownerWorkspaces(env)[pend0.slug] === String(s.user.email).toLowerCase() };
  const agentNumber = Number((await pool.query('select agent_number from "user" where id = $1', [s.user.id])).rows[0]?.agent_number) || null;
  return json(200, { deskBase: String(env.DESK_BASE_DOMAIN || '').toLowerCase().replace(/^\./, ''), user: { id: s.user.id, agentNumber, email: s.user.email, name: s.user.name, twoFactor: !!s.user.twoFactorEnabled, emailVerified: !!s.user.emailVerified }, organizations: out, pendingWorkspace: pend, banner: publicBanner(await platformSettings(pool)) });
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
  logInfo('billing', { why: r.why, ok: r.ok, plan: r.plan, org: r.orgId, event_id: ev && ev.event_id });
  if (!r.ok) { console.warn('paddle event not applied:', r.why, ev && ev.event_id); return json(r.why === 'malformed' ? 400 : 200, { ok: false, why: r.why }); }          // an event we cannot use is acknowledged (200) so Paddle does not retry it forever
  if (r.orgId && r.why === 'applied') await audit(pool, r.orgId, null, 'plan-changed', r.orgId, { plan: r.plan, seats: r.seats, status: r.status });
  return json(200, { ok: true, why: r.why });
}

// the agent desk: ONE door, POST {orgId, action, ...}. Every member of the organization may work tickets; the organization is checked on every call.
// changes that go into the audit log without further ado (team and plan changes write their own entries)
const AUDITED = new Set(['wstatus-component-save', 'wstatus-component-delete', 'wstatus-incident-create', 'wstatus-incident-update', 'wstatus-incident-delete', 'status-save', 'status-delete', 'queue-save', 'queue-delete', 'macro-save', 'macro-delete', 'rule-save', 'rule-delete', 'token-create', 'token-delete', 'webhook-save', 'webhook-delete', 'sla-save', 'sla-hours-save', 'field-save', 'field-delete', 'sso-save', 'sso-delete', 'chat-save', 'mail-save', 'client-save', 'client-delete', 'article-delete', 'migrate-run', 'role-save', 'role-delete', 'routing-save', 'whatsapp-save', 'whatsapp-delete', 'whatsapp-template-save', 'whatsapp-template-delete', 'form-save', 'form-delete', 'role-assign', 'merge', 'bulk', 'edit-message', 'delete-file']);
const LIGHT_OK = new Set(['presence', 'availability-get', 'availability-set', 'ai-summary', 'fields-list', 'init', 'list', 'get', 'note', 'follow', 'dashboard', 'agents', 'prefs-save', 'article-list', 'article-get', 'mail-get']);
export async function tickets(req, { pool, auth, mailer, store, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const b = await readJson(req, 60000); if (!b) return json(400, { error: 'That request could not be read.' });
  const orgId = String(b.orgId || ''); let role = orgId && await roleIn(pool, s.user.id, orgId), support = false;
  // the platform owner may look in, read-only; every visit is logged for the customer (support-enter)
  if (!role && orgId && s.user.emailVerified && platformAdmins().includes(String(s.user.email).toLowerCase())) {
    if (!SUPPORT_READ.has(String(b.action))) return json(403, { error: 'This is the read-only support view. Nothing can be changed here.', support: true });
    role = 'admin'; support = true;
  }
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  const actor = { id: s.user.id, name: s.user.name, email: s.user.email };
  annotate({ org: orgId, user: s.user.id, role, action: String(b.action || ''), support: support || undefined });
  if (role === 'light' && !LIGHT_OK.has(String(b.action))) return json(403, { error: 'Light agents can read tickets and add internal notes. Ask an admin to make you a full agent.' });
  // the plan and the custom role are looked up side by side (each is a trip to the database)
  const isAdmin = role === 'owner' || role === 'admin', [ent, cr] = await Promise.all([getEntitlements(pool, orgId), role === 'member' && !support ? customRoleOf(pool, orgId, s.user.id) : null]), perm = permFor(String(b.action));
  // a workspace the platform owner has suspended can be looked at by support, nothing else
  if (ent.suspended && !support) return json(403, { error: 'This workspace is suspended' + (ent.suspendedReason ? ': ' + ent.suspendedReason : '') + '. Contact support to get it back.', suspended: true });
  // a custom role limits what a full agent may change
  if (cr && perm && !cr.permissions.includes(perm)) return json(403, { error: `Your role (${cr.name}) does not allow this. Ask an admin.` });
  // a feature of a higher plan: refuse with the name of the plan that has it
  const need = f => planHas(ent, f) ? null : json(402, { error: `This is part of the ${PLANS[Object.keys(PLANS).find(k => PLANS[k].features.includes(f))].name} plan. Upgrade to use it.`, upgrade: true });
  const adminOnly = () => isAdmin ? null : json(403, { error: 'Only an owner or an admin can change this.' });
  let r, g;
  switch (b.action) {
    case 'support-enter': if (!support) return json(403, { error: 'Only the platform owner can do that.' }); await audit(pool, orgId, actor.id, 'support.entered', actor.email, {}); r = { ok: true }; break;
    case 'support-access-get': if ((g = adminOnly())) return g; r = { ok: true, active: true, always: true, entries: await recentEntries(pool, orgId) }; break;
    case 'init': {
      const fields = planHas(ent, 'custom_fields') ? (await listFields(pool, orgId)).fields : [];
      const [agents, labels, queues, clients, macros, views, statuses] = await Promise.all([listAgents(pool, orgId), desk.labelsInUse(pool, orgId), planHas(ent, 'queues') ? desk.listQueues(pool, orgId) : { queues: [] }, planHas(ent, 'clients') ? desk.listClients(pool, orgId) : { clients: [] }, desk.listMacros(pool, orgId), planHas(ent, 'saved_views') ? desk.listViews(pool, orgId, actor) : { views: [] }, planHas(ent, 'queues') ? desk.listStatuses(pool, orgId) : { statuses: [] }]);
      const pref = (await pool.query('select theme, notify, avatar from desk_prefs where user_id = $1', [actor.id])).rows[0], theme = usableTheme(pref?.theme, planHas(ent, 'themes'));
      r = { ok: true, support, perms: cr ? cr.permissions : null, customRole: cr ? cr.name : null, fields, theme, avatar: pref ? pref.avatar : null, notify: pref ? pref.notify : true, sla: planHas(ent, 'sla') ? (await getSla(pool, orgId)).policies : null, agents, labels: labels.labels, queues: queues.queues, statuses: statuses.statuses, clients: clients.clients, macros: macros.macros, views: views.views, features: [...ent.features], plan: ent.plan, admin: isAdmin }; break;
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
    case 'tokens-list': if ((g = adminOnly() || need('api'))) return g; r = await listTokens(pool, orgId); break;
    case 'token-create': if ((g = adminOnly() || need('api'))) return g; r = await createToken(pool, orgId, actor.id, b.name); break;
    case 'token-delete': if ((g = adminOnly() || need('api'))) return g; if (!(await deleteToken(pool, orgId, b.id))) return json(404, { error: 'No such token.' }); r = { ok: true }; break;
    case 'roles-list': if ((g = adminOnly() || need('custom_roles'))) return g; r = await listRoles(pool, orgId); break;
    case 'role-save': if ((g = adminOnly() || need('custom_roles'))) return g; r = await saveRole(pool, orgId, b); break;
    case 'role-delete': if ((g = adminOnly() || need('custom_roles'))) return g; if (!(await deleteRole(pool, orgId, b.id))) return json(404, { error: 'No such role.' }); r = { ok: true }; break;
    case 'role-assign': if ((g = adminOnly() || need('custom_roles'))) return g; r = await assignRole(pool, orgId, b.userId, b.roleId); break;
    case 'audit-list': if ((g = adminOnly() || need('audit_log'))) return g; r = await listAudit(pool, orgId, b); break;
    case 'audit-csv': if ((g = adminOnly() || need('audit_log'))) return g; r = await auditCsv(pool, orgId, b); break;
    case 'export-info': if ((g = adminOnly() || need('data_export'))) return g; r = await exportInfo(pool, orgId); break;
    case 'export-data': if ((g = adminOnly() || need('data_export'))) return g; r = await exportData(pool, orgId, b.part); if (r.ok) await audit(pool, orgId, actor.id, 'data-exported', 'part ' + r.part, { tickets: r.tickets }); break;
    case 'export-tickets-csv': if ((g = adminOnly() || need('data_export'))) return g; r = await ticketsCsv(pool, orgId); if (r.ok) await audit(pool, orgId, actor.id, 'data-exported', 'tickets csv', {}); break;
    case 'agent-detail': if ((g = adminOnly())) return g; r = await agentDetail(pool, orgId, b.userId, { auditOn: planHas(ent, 'audit_log') }); break;
    case 'routing-get': if ((g = adminOnly() || need('routing'))) return g; r = { ok: true, settings: await getRouting(pool, orgId) }; break;
    case 'routing-save': if ((g = adminOnly() || need('routing'))) return g; r = await saveRouting(pool, orgId, b); break;
    case 'availability-get': r = { ok: true, available: await myAvailability(pool, orgId, actor.id) }; break;
    case 'availability-set': r = await setAvailable(pool, orgId, actor.id, b.available !== false); break;
    case 'presence': r = b.leave ? (await leavePresence(pool, orgId, actor, b.number), { ok: true, others: [] }) : await heartbeat(pool, orgId, actor, b.number, b.typing === true); break;
    case 'forms-list': if ((g = adminOnly() || need('request_forms'))) return g; r = await listForms(pool, orgId); break;
    case 'form-save': if ((g = adminOnly() || need('request_forms'))) return g; r = await saveForm(pool, orgId, b); break;
    case 'form-delete': if ((g = adminOnly() || need('request_forms'))) return g; if (!(await deleteForm(pool, orgId, b.id))) return json(404, { error: 'No such form.' }); r = { ok: true }; break;
    case 'team-list': if ((g = adminOnly())) return g; r = await listTeam(pool, orgId, ent); break;
    case 'team-role': if ((g = adminOnly() || (b.role === 'light' ? need('light_agents') : null))) return g; r = await changeRole(pool, orgId, actor, role, b.memberId, b.role); if (r.ok) await audit(pool, orgId, actor.id, 'role-changed', r.email, { from: r.from, to: r.role }); break;
    case 'team-remove': if ((g = adminOnly())) return g; r = await removeMember(pool, orgId, actor, role, b.memberId, b.reassignTo); if (r.ok) await clearAssignment(pool, orgId, r.userId || ''); if (r.ok) await audit(pool, orgId, actor.id, 'member-removed', r.email, { reassigned: r.reassigned }); break;
    case 'team-invite': {
      if ((g = adminOnly())) return g; const em = String(b.email || '').trim().toLowerCase(), rl = b.role === 'admin' ? 'admin' : 'member';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return json(400, { error: 'Enter a valid email address.' });
      try { await auth.api.createInvitation({ body: { email: em, role: rl, organizationId: orgId }, headers: req.headers }); r = { ok: true, email: em }; } catch (e) { return json(400, { error: String((e && e.message) || 'The invitation could not be sent.').slice(0, 200) }); }
      await audit(pool, orgId, actor.id, 'invited', em, { role: rl }); break;
    }
    case 'team-invite-cancel': if ((g = adminOnly())) return g; r = await cancelInvite(pool, orgId, b.id); break;
    case 'team-invite-resend': if ((g = adminOnly())) return g; r = await resendInvite(pool, mailer, orgId, actor, b.id); break;
    case 'webhooks-list': if ((g = adminOnly() || need('integrations'))) return g; r = await listHooks(pool, orgId); break;
    case 'webhook-save': if ((g = adminOnly() || need('integrations'))) return g; r = await saveHook(pool, orgId, b); break;
    case 'webhook-delete': if ((g = adminOnly() || need('integrations'))) return g; if (!(await deleteHook(pool, orgId, b.id))) return json(404, { error: 'No such webhook.' }); r = { ok: true }; break;
    case 'dashboard': r = await dashboard(pool, orgId, actor, { portalDomain: String(env.PORTAL_DOMAIN || '').toLowerCase(), sla: planHas(ent, 'sla') ? await calendarOf(pool, orgId) : null, agents: (await listAgents(pool, orgId)).length }); break;
    case 'sla-get': if ((g = need('sla'))) return g; r = await getSla(pool, orgId); break;
    case 'sla-hours-get': if ((g = need('sla'))) return g; r = await getHours(pool, orgId); break;
    case 'sla-hours-save': if ((g = adminOnly() || need('sla'))) return g; r = await saveHours(pool, orgId, b); break;
    case 'sla-save': if ((g = adminOnly() || need('sla'))) return g; r = await saveSla(pool, orgId, b.policies); break;
    case 'report': if ((g = need('reports'))) return g; r = await buildReport(pool, orgId, b.days); break;
    case 'report-csv': if ((g = need('reports'))) return g; r = await reportCsv(pool, orgId, b.days); break;
    case 'list': {
      if (!planHas(ent, 'sla')) b.sla = undefined;
      const cal = planHas(ent, 'sla') ? await calendarOf(pool, orgId) : null;
      if (cal && cal.enabled && (b.sla === 'breached' || b.sla === 'risk')) { b.numbers = await slaNumbers(pool, orgId, b.sla, cal); }
      r = await listTickets(pool, orgId, actor, b);
      if (r.ok && planHas(ent, 'sla')) { const pol = (await getSla(pool, orgId)).policies; r.tickets = r.tickets.map(t => ({ ...t, sla: slaOf(t, pol, Date.now(), cal) })); }
      break;
    }
    case 'get': {
      r = await getTicket(pool, orgId, actor, b.number);
      if (r.ok) Object.assign(r, { extras: await desk.extras(pool, orgId, actor, r.ticket) });
      if (r.ok) r.ticket = { ...r.ticket, csat: await ratingOf(pool, orgId, b.number) };
      if (r.ok) r.delivery = r.ticket.channel === 'whatsapp' ? await wa.deliveryOf(pool, orgId, b.number) : await emailDeliveryOf(pool, orgId, b.number);
      if (r.ok && planHas(ent, 'sla')) r.ticket = { ...r.ticket, sla: slaOf(r.ticket, (await getSla(pool, orgId)).policies, Date.now(), await calendarOf(pool, orgId)) };
      break;
    }
    case 'queue-save': if ((g = adminOnly() || need('queues'))) return g; r = await desk.saveQueue(pool, orgId, b); break;
    case 'status-save': if ((g = adminOnly() || need('queues'))) return g; r = await desk.saveStatus(pool, orgId, b); break;
    case 'status-delete': if ((g = adminOnly() || need('queues'))) return g; r = await desk.deleteStatus(pool, orgId, b.id); break;
    case 'wstatus-list': if ((g = adminOnly() || need('queues'))) return g; r = await statusSvc.adminList(pool, orgId); break;
    case 'wstatus-component-save': if ((g = adminOnly() || need('queues'))) return g; r = await statusSvc.saveComponent(pool, b, orgId); break;
    case 'wstatus-component-delete': if ((g = adminOnly() || need('queues'))) return g; r = await statusSvc.deleteComponent(pool, b.id, orgId); break;
    case 'wstatus-incident-create': if ((g = adminOnly() || need('queues'))) return g; r = await statusSvc.createIncident(pool, actor.email || actor.name || 'agent', b, orgId); break;
    case 'wstatus-incident-update': if ((g = adminOnly() || need('queues'))) return g; r = await statusSvc.postUpdate(pool, actor.email || actor.name || 'agent', b.id, b, orgId); break;
    case 'wstatus-incident-delete': if ((g = adminOnly() || need('queues'))) return g; r = await statusSvc.deleteIncident(pool, b.id, orgId); break;
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
    case 'fields-list': r = planHas(ent, 'custom_fields') ? await listFields(pool, orgId) : { ok: true, fields: [], types: [] }; break;
    case 'field-save': if ((g = adminOnly() || need('custom_fields'))) return g; r = await saveField(pool, orgId, b); break;
    case 'field-delete': if ((g = adminOnly() || need('custom_fields'))) return g; if (!(await deleteField(pool, orgId, b.id))) return json(404, { error: 'No such field.' }); r = { ok: true }; break;
    case 'create': {
      if (b.custom && (g = need('custom_fields'))) return g;
      r = await createTicket(pool, orgId, actor, b);
      if (!r.ok) break;
      const num = r.ticket.number, first = b.firstKind === 'agent' || b.firstKind === 'note' ? b.firstKind : 'requester';
      if (store && Array.isArray(b.attachmentIds) && b.attachmentIds.length) await claimUploads(pool, orgId, actor, num, r.messageRowId, b.attachmentIds);
      if (b.patch && typeof b.patch === 'object') {                      // the properties set on the form: assignee, queue, type, tags, cc, status
        const pt = b.patch; if (pt.custom !== undefined && (g = need('custom_fields'))) return g; if (pt.queueId !== undefined && (g = need('queues'))) return g; if (pt.clientId !== undefined && (g = need('clients'))) return g; if (pt.customStatusId !== undefined && pt.customStatusId !== null && pt.customStatusId !== '' && (g = need('queues'))) return g;
        const u = await updateTicket(pool, orgId, actor, num, pt); if (!u.ok) r.warning = u.error; else {
          if (u.ticket) r.ticket = u.ticket;
          if (pt.assigneeId && pt.assigneeId !== actor.id) await notifyTicket(pool, mailer, orgId, num, { kind: 'assigned', onlyUserId: String(pt.assigneeId), actorId: actor.id, summary: `${actor.name || actor.email} assigned it to you.` });
        }
      }
      if (b.follow) await desk.follow(pool, orgId, actor, num, true);
      if (first === 'agent' && mailer) {
        const rows = store ? await filesOfMessage(pool, orgId, r.messageRowId) : [], files = [];
        for (const f of rows) { const x = await readFile(pool, store, orgId, f.id); if (x) files.push(x); }
        const d = await sendTicketReply(pool, mailer, env, orgId, num, r.messageRowId, files); r.email = d.delivery; r.emailWhy = d.why;
      }
      if (planHas(ent, 'triggers') && first === 'requester') await runTriggers(pool, mailer, env, orgId, 'created', num, String(b.body || ''));
      if (b.patch && b.patch.status === 'solved') await surveyIfSolved(pool, mailer, env, orgId, num);
      await emitHook(pool, orgId, 'ticket.created', num);
      if (first === 'agent') await emitHook(pool, orgId, 'message.agent', num, { message: { author: actor.name || actor.email, body: String(b.body || '').slice(0, 2000) } });
      break;
    }
    case 'reply': {
      if (!b.force && b.seenMessageId) { const fresh = await newSince(pool, orgId, actor.id, b.number, b.seenMessageId); if (fresh.length) return json(409, { error: `${[...new Set(fresh.map(m => m.author_name || 'Someone'))].slice(0, 3).join(', ')} wrote on this ticket since you opened it.`, conflict: true, messages: fresh.length }); }
      if (await recentDuplicate(pool, orgId, actor.id, b.number, b.body)) return json(409, { error: 'That exact message was just sent. It was not sent a second time.', duplicate: true });
      const wst = await wa.windowState(pool, orgId, b.number);
      if (wst && !wst.open) return json(409, { error: 'WhatsApp only lets you reply within 24 hours of the customer\'s last message. Nothing was sent. Your text is still here.', window: true });
      r = await addMessage(pool, orgId, actor, b.number, { body: b.body, internal: false, status: b.status });
      if (r.ok && wst) { const d = await wa.sendReply(pool, env, orgId, Number(b.number), r.message.id, b.body, env.__waFetch || fetch); r.whatsapp = d.delivery; r.whatsappWhy = d.why; }
      if (r.ok && store && Array.isArray(b.attachmentIds) && b.attachmentIds.length) await claimUploads(pool, orgId, actor, b.number, r.message.id, b.attachmentIds);
      if (r.ok && mailer && !wst && !(await chatOpen(pool, orgId, b.number))) {
        const rows = store ? await filesOfMessage(pool, orgId, r.message.id) : [], files = [];
        for (const f of rows) { const x = await readFile(pool, store, orgId, f.id); if (x) files.push(x); }
        const d = await sendTicketReply(pool, mailer, env, orgId, Number(b.number), r.message.id, files); r.email = d.delivery; r.emailWhy = d.why;
      }
      if (r.ok && b.status === 'solved') await surveyIfSolved(pool, mailer, env, orgId, b.number);
      if (r.ok) await emitHook(pool, orgId, 'message.agent', b.number, { message: { author: actor.name || actor.email, body: String(b.body || '').slice(0, 2000) } });
      break;
    }
    case 'delete-file': if (!store || !(await deleteFile(pool, store, orgId, b.id))) return json(404, { error: 'No such file.' }); r = { ok: true }; break;
    case 'article-list': r = await listArticles(pool, orgId); break;
    case 'article-get': r = await getArticle(pool, orgId, b.id); break;
    case 'article-save': r = await saveArticle(pool, orgId, actor, b); break;
    case 'article-delete': if (!(await deleteArticle(pool, orgId, b.id))) return json(404, { error: 'No such article.' }); r = { ok: true }; break;
    case 'migrate-check': case 'migrate-run': {
      if ((g = adminOnly())) return g;
      if (!PROVIDERS.includes(b.provider)) return json(400, { error: 'Choose Zendesk or Freshdesk.' });
      try {
        const src = migrationSource(b.provider, b.creds, env.__migrationFetch || fetch);
        if (b.action === 'migrate-check') { r = await src.check(); break; }
        const pg = await src.page(b.cursor && typeof b.cursor === 'object' ? b.cursor : null);
        const done = await importMdv(pool, orgId, { tickets: pg.tickets, articles: pg.articles }, { dryRun: b.dryRun === true, source: b.provider });
        if (!done.ok) return json(done.status || 400, { error: done.error });
        r = { ok: true, next: pg.next, progress: pg.progress, tickets: done.tickets, messages: done.messages, articles: done.articles, filesNotCopied: done.filesNotCopied, unassigned: done.unassigned, warnings: done.warnings };
      } catch (e) {
        if (e instanceof Wait) return json(429, { error: `The provider asked us to slow down. Waiting ${e.retryAfter} seconds.`, retryAfter: e.retryAfter });
        if (e instanceof Bad) return json(e.status === 502 ? 502 : 400, { error: e.message });
        return json(502, { error: 'We could not reach the provider. Try again in a minute.' });
      }
      break;
    }
    case 'ai-suggest': case 'ai-summary': case 'ai-rewrite': case 'ai-usage': {
      if ((g = need('ai_assist'))) return g;
      const f = env.__aiFetch || fetch;
      r = b.action === 'ai-suggest' ? await suggestReply(pool, env, orgId, actor, b.number, f) : b.action === 'ai-summary' ? await aiSummarize(pool, env, orgId, actor, b.number, f) : b.action === 'ai-rewrite' ? await aiRewrite(pool, env, orgId, b.mode, b.text, f) : { ok: true, ...(await aiUsage(pool, env, orgId)) };
      break;
    }
    case 'sso-get': if ((g = adminOnly())) return g; if ((g = need('sso'))) return g; r = { ok: true, sso: await getSso(pool, orgId), callback: `${PRODUCT.appUrl}/api/auth/sso/callback` }; break;
    case 'sso-save': if ((g = adminOnly())) return g; if ((g = need('sso'))) return g; r = await saveSso(pool, env, orgId, b); break;
    case 'sso-delete': if ((g = adminOnly())) return g; r = await deleteSso(pool, orgId); break;
    case 'whatsapp-get': if ((g = adminOnly())) return g; if ((g = need('whatsapp'))) return g; r = { ok: true, settings: await wa.getSettings(pool, env, orgId, siteBase(req, env)) }; break;
    case 'whatsapp-save': if ((g = adminOnly())) return g; if ((g = need('whatsapp'))) return g; r = await wa.saveSettings(pool, env, orgId, b, siteBase(req, env)); break;
    case 'whatsapp-delete': if ((g = adminOnly())) return g; r = await wa.deleteAccount(pool, orgId); break;
    case 'whatsapp-templates': if ((g = need('whatsapp'))) return g; r = { ok: true, templates: await wa.listTemplates(pool, orgId) }; break;
    case 'whatsapp-template-save': if ((g = adminOnly())) return g; if ((g = need('whatsapp'))) return g; r = await wa.saveTemplate(pool, orgId, b); break;
    case 'whatsapp-template-delete': if ((g = adminOnly())) return g; r = await wa.deleteTemplate(pool, orgId, b.name, b.language); break;
    case 'whatsapp-template-send': {
      if ((g = need('whatsapp'))) return g;
      r = await wa.sendTemplate(pool, env, orgId, actor, b.number, b, env.__waFetch || fetch);
      if (r.ok && b.status === 'solved') await surveyIfSolved(pool, mailer, env, orgId, b.number);
      break;
    }
    case 'chat-get': if ((g = need('live_chat'))) return g; r = { ok: true, settings: await chatSettings(pool, orgId) }; break;
    case 'chat-save': if ((g = adminOnly())) return g; if ((g = need('live_chat'))) return g; r = await saveChatSettings(pool, orgId, b); break;
    case 'mail-get': r = await getMailSettings(pool, orgId, env); r.csatOn = await csatOn(pool, orgId); break;
    case 'csat-set': if ((g = adminOnly())) return g; await setCsatOn(pool, orgId, b.on === true); r = { ok: true, csatOn: b.on === true }; break;
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
      const pt = b.patch || {}; if (pt.custom !== undefined && (g = need('custom_fields'))) return g; if (pt.queueId !== undefined && (g = need('queues'))) return g; if (pt.clientId !== undefined && (g = need('clients'))) return g;
      const was = pt.assigneeId ? (await pool.query('select assignee_id from tickets where org_id = $1 and number = $2', [orgId, Number(b.number) || 0])).rows[0]?.assignee_id : null;
      r = await updateTicket(pool, orgId, actor, b.number, pt);
      if (r.ok) await emitHook(pool, orgId, 'ticket.updated', b.number, { changes: Object.keys(pt) });
      if (r.ok && pt.status === 'solved') await surveyIfSolved(pool, mailer, env, orgId, b.number);
      if (r.ok && pt.assigneeId && pt.assigneeId !== was && pt.assigneeId !== actor.id) await notifyTicket(pool, mailer, orgId, b.number, { kind: 'assigned', onlyUserId: String(pt.assigneeId), actorId: actor.id, summary: `${actor.name || actor.email} assigned it to you.` });
      break;
    }
    case 'bulk': {
      if ((g = need('bulk_actions'))) return g;
      const nums = [...new Set((Array.isArray(b.numbers) ? b.numbers : []).map(Number).filter(n => Number.isInteger(n) && n > 0))].slice(0, 100), p = b.patch || {}; if (!nums.length) return json(400, { error: 'Choose some tickets first.' });
      const patch = {}; for (const k of ['status', 'priority', 'assigneeId', 'customStatusId']) if (p[k] !== undefined) patch[k] = p[k]; if (patch.customStatusId !== undefined && (g = need('queues'))) return g;
      if (!Object.keys(patch).length && !p.addTag) return json(400, { error: 'Choose what to change.' });
      let done = 0, failed = 0, firstError = '';
      for (const n of nums) {
        const one = { ...patch }; if (p.addTag) { const cur = (await pool.query('select tags from tickets where org_id = $1 and number = $2', [orgId, n])).rows[0]; if (cur) one.tags = [...new Set([...(cur.tags || []), String(p.addTag).toLowerCase()])]; }
        const res = await updateTicket(pool, orgId, actor, n, one); if (res.ok) { done++; if (patch.status === 'solved') await surveyIfSolved(pool, mailer, env, orgId, n); } else { failed++; firstError = firstError || res.error; }
      }
      r = { ok: true, done, failed, ...(firstError ? { error: firstError } : {}) }; break;
    }
    case 'agents': r = { ok: true, agents: await listAgents(pool, orgId) }; break;
    default: return json(400, { error: 'Unknown action.' });
  }
  if (r.ok && AUDITED.has(String(b.action)) && !support) await audit(pool, orgId, actor.id, String(b.action), String(b.id ?? b.userId ?? b.number ?? b.name ?? b.key ?? '').slice(0, 120) || null, {}).catch(() => {});
  return r.ok ? json(200, r) : json(r.status || 400, { error: r.error });
}

// customers' email, posted by Resend (event email.received). The signature is checked on the exact bytes, the full message is fetched with our key, and anything we cannot use is acknowledged so it is not retried forever.
export async function inboundEmail(req, { pool, store, mailer, env = process.env, fetchFn = fetch, now = Date.now() }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text(); if (raw.length > 100000) return json(413, { error: 'Too large.' });
  if (!verifySvix(raw, req.headers, env.RESEND_WEBHOOK_SECRET, now)) return json(401, { error: 'Bad signature.' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { error: 'Not JSON.' }); }
  if (ev && isReceiptEvent(ev.type)) { await applyReceipt(pool, ev); return json(200, { ok: true, receipt: true }); }
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
  logInfo('inbound_email', { action: res.action, dropped: res.dropped, org: res.orgId, ticket: res.number });
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

// a ticket's thread or one message, to print (PDF) or as an .eml file: GET /api/ticket-export?org=…&number=…&format=print|eml[&message=…][&notes=1]
export async function ticketExport(req, { pool, auth }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  const u = new URL(req.url), orgId = String(u.searchParams.get('org') || ''), role = orgId && await roleIn(pool, s.user.id, orgId);
  if (!role) return json(403, { error: 'You are not part of that organization.' });
  const t = await getTicket(pool, orgId, { id: s.user.id }, u.searchParams.get('number')); if (!t.ok) return json(t.status || 404, { error: t.error });
  const mid = u.searchParams.get('message') || '', msgs = pickMessages(t.messages, { messageId: mid, notes: u.searchParams.get('notes') === '1' });
  if (mid && !msgs.length) return json(404, { error: 'No such message.' });
  const org = (await pool.query('select name from "organization" where id = $1', [orgId])).rows[0] || {}, fmt = u.searchParams.get('format') === 'eml' ? 'eml' : 'print';
  if (fmt === 'eml') return new Response(emlFile(t.ticket, msgs, { messageId: mid }), { status: 200, headers: { 'Content-Type': 'message/rfc822', 'Content-Disposition': `attachment; filename="ticket-${t.ticket.number}${mid ? '-message-' + String(mid).replace(/\D/g, '') : ''}.eml"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return new Response(printPage(t.ticket, msgs, { orgName: org.name, auto: u.searchParams.get('auto') === '1' }), { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" } });
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
  annotate({ org: org.id });
  const base = `/help/${org.slug}`, rest = parts.slice(1), secure = u.protocol === 'https:', portal = portalOrigin(req, env, org.slug);
  const form = async () => { const t = await req.text(); if (t.length > 40000) return new URLSearchParams(); return new URLSearchParams(t); };
  if (post) { const o = req.headers.get('origin'); if (o && new URL(o).host !== u.host) return json(403, { error: 'Bad origin.' }); }
  const cookie = cookieOf(req, COOKIE), sess = readSession(env, cookie, org.id, now);
  const setCookie = v => `${COOKIE}=${v}; Path=/help; HttpOnly; SameSite=Lax; Max-Age=${v ? SESSION_SECONDS : 0}${secure ? '; Secure' : ''}`;
  const notFound = () => html(404, pages.notFoundPage({ org, lang, base }), {});
  // the workspace's own status page (Team plan and up): /help/<slug>/status, /status/json, /status/feed.xml, /status/incidents/<n>
  if (rest[0] === 'status') {
    if (post) return json(405, { error: 'Method not allowed.' });
    if (!planHas(await getEntitlements(pool, org.id), 'queues')) return notFound();
    const sb = `${base}/status`, brand = { name: org.name, home: base }, hdr = (type, extra = {}) => ({ 'content-type': type, 'cache-control': 'public, max-age=30', ...extra });
    if (rest.length === 1) return new Response(statusSvc.renderPage(await statusSvc.overview(pool, Date.now(), org.id), { base: sb, title: org.name + ' status', json: sb + '/json', brand }), { status: 200, headers: hdr('text/html; charset=utf-8') });
    if (rest[1] === 'json' && rest.length === 2) return new Response(JSON.stringify(statusSvc.renderJson(await statusSvc.overview(pool, Date.now(), org.id), org.name)), { status: 200, headers: hdr('application/json', { 'access-control-allow-origin': '*' }) });
    if (rest[1] === 'feed.xml' && rest.length === 2) return new Response(statusSvc.renderFeed(await statusSvc.overview(pool, Date.now(), org.id), u.origin, { path: sb, name: org.name }), { status: 200, headers: hdr('application/atom+xml; charset=utf-8') });
    if (rest[1] === 'incidents' && /^\d+$/.test(rest[2] || '') && rest.length === 3) { const i = await statusSvc.getIncident(pool, rest[2], org.id); return i ? new Response(statusSvc.renderIncident(i, sb, brand), { status: 200, headers: hdr('text/html; charset=utf-8') }) : notFound(); }
    return notFound();
  }
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
  // the search box for a customer's own website: a small JSON answer any page may ask for (published articles only)
  if (rest[0] === 'api' && rest[1] === 'search' && !post) {
    const hdr = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=60', 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
    const q = String(u.searchParams.get('q') || '').slice(0, 100), found = await searchArticles(pool, org.id, q, lang);
    return new Response(JSON.stringify({ ok: true, name: org.name, results: found.slice(0, 6).map(a => ({ title: a.title, excerpt: String(a.excerpt || '').replace(/[#*`\[\]]/g, '').slice(0, 140), url: `${portal || PRODUCT.appUrl}${base}/a/${a.slug}?lang=${a.lang}` })), request: `${portal || PRODUCT.appUrl}${base}/requests/new?lang=${lang}` }), { status: 200, headers: hdr });
  }
  // request forms
  if (rest[0] === 'requests' && rest[1] === 'new') {
    const ent = await getEntitlements(pool, org.id), custom = planHas(ent, 'request_forms'), fields = planHas(ent, 'custom_fields'), forms = await publicForms(pool, org.id, { custom, fields });
    const pickForm = id => forms.find(f => String(f.id) === String(id)) || null;
    if (!post) return html(200, pages.requestPage({ org, lang, base, forms, form: pickForm(u.searchParams.get('form')), token: requestToken(env, org.id, now) }));
    const f = await form(), vals = Object.fromEntries(f.entries()), r = await submitRequest(pool, env, org, vals, { mailer, custom, fields, now });
    if (r.silent) return html(200, pages.requestDonePage({ org, lang, base, number: 0 }));
    if (!r.ok) return html(r.status === 404 ? 404 : r.status || 400, pages.requestPage({ org, lang, base, forms, form: pickForm(vals.form), token: requestToken(env, org.id, now - 3500), values: vals, error: r.error, field: r.field }));
    return html(200, pages.requestDonePage({ org, lang, base, number: r.number }));
  }
  // the rating page from the survey email
  if (rest[0] === 'csat' && /^\d{1,9}$/.test(rest[1] || '')) {
    const n = Number(rest[1]);
    if (!post) { const t = u.searchParams.get('t') || ''; if (!tokenOk(env, org.id, n, t)) return notFound(); return html(200, pages.csatPage({ org, lang, base, number: n, token: t, pre: u.searchParams.get('r') })); }
    const f = await form(); if (!tokenOk(env, org.id, n, f.get('t'))) return notFound();
    const ok = await rate(pool, org.id, n, f.get('r'), f.get('comment')); if (!ok) return notFound();
    return html(200, pages.csatPage({ org, lang, base, number: n, token: '', done: true }));
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
export async function workspaceCheck(req, { pool, env = process.env, now = Date.now() }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  if (tooMany(String(req.headers.get('x-forwarded-for') || 'x').split(',')[0].trim(), now)) return json(429, { error: 'Too many checks. Wait a minute.' });
  const q = new URL(req.url).searchParams; return json(200, await slugStatus(pool, q.get('slug'), { email: q.get('email') || '', env }));
}
// registration: checks the company and address, creates the account through Better Auth (so its limits and rules all apply), and holds the address for the person
export async function signup(req, { pool, auth, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const b = await readJson(req); if (!b) return json(400, { message: 'That request could not be read.' });
  const ps = await platformSettings(pool); if (!ps.signups.open) return json(403, { message: ps.signups.message || 'New sign-ups are paused right now. Please try again soon.', code: 'SIGNUPS_PAUSED' });
  const company = cleanCompany(b.company), st = await slugStatus(pool, b.slug, { email: String(b.email || ''), env });
  if (company.length < 2) return json(400, { message: 'Enter your company name.', code: 'COMPANY' });
  if (!st.available) return json(409, { message: st.reason, code: 'SLUG_TAKEN' });
  const headers = new Headers({ 'content-type': 'application/json' }); for (const h of ['x-forwarded-for', 'origin', 'referer', 'user-agent']) if (req.headers.get(h)) headers.set(h, req.headers.get(h));
  const r = await signupContext.run({ company }, () => auth.handler(new Request(new URL('/api/auth/sign-up/email', req.url), { method: 'POST', headers, body: JSON.stringify({ name: b.name, email: b.email, password: b.password, callbackURL: '/welcome.html' }) })));
  if (!r.ok) return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const u = (await pool.query(`select id from "user" where lower(email) = $1 and "emailVerified" = false and "createdAt" > now() - interval '1 minute' and not exists (select 1 from pending_signups where user_id = "user".id)`, [String(b.email || '').trim().toLowerCase()])).rows[0];       // only an account created by THIS request: an existing address (Better Auth answers the same way, to avoid revealing it) must never get its pending workspace changed
  if (u && !(await holdSlug(pool, u.id, company, st.slug))) { await pool.query('delete from "user" where id = $1', [u.id]); return json(409, { message: 'That address was just taken. Choose another.', code: 'SLUG_TAKEN' }); }
  logInfo('signup', { slug: st.slug, ok: true });
  return json(200, { ok: true, slug: st.slug });
}
// after the confirmation link: create the workspace the person asked for (POST), or choose another address first (PATCH { slug })
export async function workspace(req, { pool, auth, env = process.env }) {
  if (req.method !== 'POST' && req.method !== 'PATCH') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified) return json(403, { error: 'Confirm your email address first.' });
  if (req.method === 'PATCH') { const b = await readJson(req); const r = b ? await changePending(pool, s.user.id, b.slug, env) : { ok: false, reason: 'Bad request.' }; return r.ok ? json(200, r) : json(409, { error: r.reason }); }
  const r = await createWorkspace(pool, auth, req.headers, s.user, env);
  return r.ok ? json(200, { ok: true, existing: r.existing, organization: r.org }) : json(r.status || 400, { error: r.error, taken: !!r.taken });
}
export const _json = json;

// THE REST API (docs/API.md): /api/v1/tickets, authenticated with a bearer token made under Manage > API. Same rules as the desk, and it starts the same webhooks and automations.
export async function apiV1(req, { pool, mailer, env = process.env }) {
  const who = await authenticate(pool, req.headers.get('authorization')).catch(() => null);
  if (!who) return json(401, { error: 'Send a valid API token: Authorization: Bearer effk.…' });
  const orgId = who.orgId; countApiCall(pool, orgId); const ent = await getEntitlements(pool, orgId); if (!planHas(ent, 'api')) return json(402, { error: 'The API is part of the Suite plan.', upgrade: true });
  const actor = { id: null, name: 'API: ' + who.name, email: '' }, u = new URL(req.url), parts = u.pathname.replace(/^\/api\/v1\/?/, '').split('/').filter(Boolean), m = req.method;
  let b = {}; if (m === 'POST' || m === 'PATCH') { const raw = await req.text(); if (raw.length > 100000) return json(413, { error: 'Too large.' }); try { b = raw ? JSON.parse(raw) : {}; } catch { return json(400, { error: 'The body must be JSON.' }); } }
  const out = r => r.ok ? json(r.status === 201 ? 201 : 200, r.body || r) : json(r.status || 400, { error: r.error });
  if (parts[0] !== 'tickets') return json(404, { error: 'Not found.' });
  const n = parts[1] ? Number(parts[1]) : 0; if (parts[1] && !/^\d{1,9}$/.test(parts[1])) return json(404, { error: 'Not found.' });
  if (!parts[1]) {
    if (m === 'GET') { const q = Object.fromEntries(u.searchParams); delete q.assignee; const r = await listTickets(pool, orgId, actor, { status: q.status, q: q.q, tag: q.tag, limit: q.limit, offset: q.offset }); return r.ok ? json(200, { tickets: r.tickets, counts: r.counts }) : out(r); }
    if (m === 'POST') { if (b.custom && !planHas(ent, 'custom_fields')) return json(402, { error: 'Custom fields are part of the Suite plan.', upgrade: true }); const r = await createTicket(pool, orgId, actor, { ...b, channel: 'api' }); if (!r.ok) return out(r); await maybeTriggers(pool, mailer, env, orgId, 'created', r.ticket.number, String(b.body || '')); await emitHook(pool, orgId, 'ticket.created', r.ticket.number); return json(201, { ticket: r.ticket }); }
    return json(405, { error: 'Method not allowed.' });
  }
  if (!parts[2]) {
    if (m === 'GET') { const r = await getTicket(pool, orgId, actor, n); return r.ok ? json(200, { ticket: r.ticket, messages: r.messages.filter(x => x.kind !== 'note' || b.notes === true).map(({ id, kind, author_name, body, created_at }) => ({ id, kind, author: author_name, body, createdAt: created_at })) }) : out(r); }
    if (m === 'PATCH') { const patch = {}; for (const k of ['status', 'priority', 'type', 'tags', 'assigneeId', 'queueId', 'cc', 'custom']) if (b[k] !== undefined) patch[k] = b[k]; if (patch.custom !== undefined && !planHas(ent, 'custom_fields')) return json(402, { error: 'Custom fields are part of the Suite plan.', upgrade: true }); const r = await updateTicket(pool, orgId, actor, n, patch); if (r.ok) await emitHook(pool, orgId, 'ticket.updated', n, { changes: Object.keys(patch) }); return r.ok ? json(200, { ticket: r.ticket }) : out(r); }
    return json(405, { error: 'Method not allowed.' });
  }
  if (parts[2] === 'comments' && !parts[3] && m === 'POST') {
    const internal = b.public === false, r = await addMessage(pool, orgId, actor, n, { body: b.body, internal, status: internal ? undefined : b.status }); if (!r.ok) return out(r);
    if (!internal && mailer) { const d = await sendTicketReply(pool, mailer, env, orgId, n, r.message.id, []); r.email = d.delivery; await emitHook(pool, orgId, 'message.agent', n, { message: { author: actor.name, body: String(b.body || '').slice(0, 2000) } }); if (b.status === 'solved') await surveyIfSolved(pool, mailer, env, orgId, n); }
    return json(201, { message: { id: r.message.id, kind: r.message.kind }, email: r.email || null });
  }
  return json(404, { error: 'Not found.' });
}

// the platform owner's list of customers and their use (counts only): GET /api/admin/customers, or ?format=csv
export async function platformList(req, { pool, auth }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified || !platformAdmins().includes(String(s.user.email).toLowerCase())) return json(403, { error: 'Only the platform owner can do that.' });
  const r = await platformCustomers(pool);
  if (new URL(req.url).searchParams.get('format') === 'csv') return new Response(customersCsv(r.customers), { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="effdesk-customers.csv"', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  return json(200, r);
}

// one customer in detail for the platform owner: team and access, billing, 30 days of usage, flags. Never ticket content.
export async function platformCustomer(req, { pool, auth }) {
  if (req.method !== 'GET') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified || !platformAdmins().includes(String(s.user.email).toLowerCase())) return json(403, { error: 'Only the platform owner can do that.' });
  const r = await customerDetail(pool, new URL(req.url).searchParams.get('slug'));
  return r.ok ? json(200, r) : json(r.status, { error: r.error });
}

const siteBase = (req, env) => { try { return env.APP_URL ? String(env.APP_URL).replace(/\/+$/, '') : new URL(req.url).origin; } catch { return ''; } };
// Meta's WhatsApp webhook: GET answers the one-time address check, POST carries messages and delivery reports
export async function whatsappWebhook(req, { pool, mailer, store, env = process.env, fetchFn = env.__waFetch || fetch }) {
  if (req.method === 'GET') { const c = await wa.verifyChallenge(pool, new URL(req.url).searchParams); return c === null ? new Response('Forbidden', { status: 403 }) : new Response(c, { status: 200, headers: { 'content-type': 'text/plain' } }); }
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text(); if (raw.length > 200000) return json(413, { error: 'Too large.' });
  const r = await wa.handleWebhook(pool, env, raw, req.headers.get('x-hub-signature-256'), mailer, { store, fetchFn });
  logInfo('whatsapp_webhook', { ok: r.ok, handled: r.handled, why: r.ok ? undefined : r.error });
  return json(r.ok ? 200 : r.status || 400, r.ok ? { ok: true } : { error: r.error });
}

// a script error reported by a browser (public, capped): see src/errors.js
export async function clientLog(req, { pool, mailer, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const raw = await req.text(); if (raw.length > 4000) return json(413, { error: 'Too large.' });
  let b; try { b = JSON.parse(raw); } catch { return json(400, { error: 'Not JSON.' }); }
  const r = await recordBrowserError(pool, mailer, env, b); return json(r.ok ? 200 : r.status || 400, r.ok ? { ok: true } : { error: r.error });
}
// is it up: checks the database and answers quickly. No secrets, nothing about customers.
export async function health(req, { pool, env = process.env }) {
  const t0 = Date.now(); let db = true; try { await pool.query('select 1'); } catch { db = false; }
  return new Response(JSON.stringify({ ok: db, db, ms: Date.now() - t0, time: new Date().toISOString(), deploy: String(env.DEPLOY_ID || env.COMMIT_REF || '').slice(0, 12) || undefined }), { status: db ? 200 : 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// the public status page: /status, /status/incidents/:id, /status/feed.xml and /api/status (JSON, readable from any website)
export async function statusPublic(req, { pool, env = process.env }) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: 'Method not allowed.' });
  const u = new URL(req.url), p = u.pathname.replace(/\/+$/, ''), origin = siteBase(req, env), hdr = (type, extra = {}) => ({ 'content-type': type, 'cache-control': 'public, max-age=30', ...extra });
  if (p === '/api/status') return new Response(JSON.stringify(statusSvc.renderJson(await statusSvc.overview(pool))), { status: 200, headers: hdr('application/json', { 'access-control-allow-origin': '*' }) });
  if (p === '/status/feed.xml') return new Response(statusSvc.renderFeed(await statusSvc.overview(pool), origin), { status: 200, headers: hdr('application/atom+xml; charset=utf-8') });
  const m = p.match(/^\/status\/incidents\/(\d+)$/);
  if (m) { const i = await statusSvc.getIncident(pool, m[1]); return i ? new Response(statusSvc.renderIncident(i), { status: 200, headers: hdr('text/html; charset=utf-8') }) : new Response('Not found', { status: 404 }); }
  if (p === '/status') return new Response(statusSvc.renderPage(await statusSvc.overview(pool)), { status: 200, headers: hdr('text/html; charset=utf-8') });
  return new Response('Not found', { status: 404 });
}

// the platform owner's console: one door for everything in src/admin-actions.js. Owners only (verified email on the PLATFORM_ADMIN_EMAILS list); changes are written to the platform audit log.
export async function adminDo(req, { pool, auth, mailer, env = process.env }) {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const s = await session(auth, req); if (!s) return json(401, { error: 'Sign in first.' });
  if (!s.user.emailVerified || !platformAdmins().includes(String(s.user.email).toLowerCase())) return json(403, { error: 'Only the platform owner can do that.' });
  const b = await readJson(req, 60000); if (!b) return json(400, { error: 'That request could not be read.' });
  const action = String(b.action || ''); annotate({ user: s.user.id, action: 'admin:' + action });
  const r = await adminActions.run(action, b, { pool, mailer, env, actor: String(s.user.email).toLowerCase() });
  if (r.ok && adminActions.MUTATING.has(action) && !action.startsWith('customer-') && !action.startsWith('user-')) await adminActions.audit(pool, String(s.user.email).toLowerCase(), action, b.id ?? b.slug ?? null, {});
  return r.ok ? json(200, r) : json(r.status || 400, { error: r.error });
}
