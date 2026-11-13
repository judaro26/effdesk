// src/webhooks.js: OUTBOUND WEBHOOKS. An organization can have a few URLs that are told, with a signed JSON message, when something happens to a ticket. Used to connect Slack automations, Zapier, a CRM or your own system.
//   Signature: header X-EffDesk-Signature = "sha256=" + HMAC-SHA256(secret, timestamp + "." + body), with X-EffDesk-Timestamp (seconds). Reject a message whose timestamp is old.
import { info as logInfo } from './log.js';
import crypto from 'node:crypto';
import { withOrg } from './db.js';
import { publicAddress, guardedFetch } from './guard.js';
export const EVENTS = ['ticket.created', 'ticket.updated', 'message.agent', 'message.customer', 'ticket.mentioned'];
export const MAX_HOOKS = 10;
export const KINDS = ['json', 'slack', 'teams', 'cliq'];
// Slack and Teams only accept their own addresses, so a chat address cannot be pointed somewhere else
const KIND_HOSTS = { slack: [/^hooks\.slack\.com$/, /^hooks\.slack-gov\.com$/], teams: [/\.webhook\.office\.com$/, /\.logic\.azure\.com$/, /^outlook\.office\.com$/, /\.powerplatform\.com$/], cliq: [/^cliq\.zoho\.(?:com|eu|in|jp)$/, /^cliq\.zoho\.com\.au$/] };
export const hostOkFor = (kind, url) => !KIND_HOSTS[kind] || KIND_HOSTS[kind].some(re => re.test(new URL(url).hostname.toLowerCase()));
const LABEL = { 'ticket.created': 'New ticket', 'ticket.updated': 'Ticket updated', 'message.agent': 'Agent replied', 'message.customer': 'Customer replied', 'ticket.mentioned': 'Teammate mentioned' };
export const chatText = (event, t, extra = {}) => `${LABEL[event] || event}: #${t.number} ${t.subject} (${t.priority}, ${t.status}) from ${t.requester_name || t.requester_email}` + (extra.message && extra.message.body ? `\n> ${String(extra.message.body).replace(/\s+/g, ' ').slice(0, 300)}` : '') + (extra.by ? `\nBy ${extra.by}` : '');
const teamsCard = text => ({ type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', body: [{ type: 'TextBlock', text, wrap: true }] } }] });
// only public https addresses: no localhost, no private ranges, no bare IP addresses, no internal names (a DNS name that points inside is not caught here; the call has a short timeout and sends no secrets of ours)
export function safeUrl(v) {
  let u; try { u = new URL(String(v || '').trim()); } catch { return null; }
  const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.port && u.port !== '443') return null;
  if (!h.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan|home|corp|test|invalid|example)$/.test(h)) return null;
  return u.toString();
}
export async function listHooks(pool, orgId) {
  return withOrg(pool, orgId, async c => ({ ok: true, events: EVENTS, webhooks: (await c.query('select id, url, kind, events, active, last_status, last_at from webhooks where org_id = $1 order by id', [orgId])).rows }));
}
export async function saveHook(pool, orgId, b, { lookup } = {}) {
  const kind = KINDS.includes(b.kind) ? b.kind : 'json';
  const url = safeUrl(b.url); if (!url) return { ok: false, status: 400, error: 'Use a public https address, for example https://hooks.example.com/effdesk.' };
  if (!(await publicAddress(new URL(url).hostname, lookup, { allowUnresolved: true }))) return { ok: false, status: 400, error: 'That address does not resolve to a public server. Use a public https address.' };
  if (!hostOkFor(kind, url)) return { ok: false, status: 400, error: kind === 'slack' ? 'That is not a Slack webhook address (it starts with https://hooks.slack.com/).' : kind === 'cliq' ? 'That is not a Zoho Cliq webhook address (use your regional cliq.zoho domain).' : 'That is not a Microsoft Teams webhook address.' };
  const events = [...new Set((Array.isArray(b.events) ? b.events : []).filter(e => EVENTS.includes(e)))]; if (!events.length) return { ok: false, status: 400, error: 'Choose at least one event.' };
  return withOrg(pool, orgId, async c => {
    if (b.id) { const r = await c.query('update webhooks set url = $3, events = $4, active = $5, kind = $6 where org_id = $1 and id = $2 returning id', [orgId, Number(b.id) || 0, url, events, b.active !== false, kind]); return r.rowCount ? { ok: true, id: r.rows[0].id } : { ok: false, status: 404, error: 'No such webhook.' }; }
    if ((await c.query('select count(*)::int n from webhooks where org_id = $1', [orgId])).rows[0].n >= MAX_HOOKS) return { ok: false, status: 400, error: `You can have up to ${MAX_HOOKS} webhooks.` };
    const secret = 'whsec_' + crypto.randomBytes(24).toString('base64url');
    const r = await c.query('insert into webhooks (org_id, url, secret, events, kind) values ($1,$2,$3,$4,$5) returning id', [orgId, url, secret, events, kind]);
    return { ok: true, id: r.rows[0].id, ...(kind === 'json' ? { secret } : {}) };                          // shown once, here
  });
}
export async function deleteHook(pool, orgId, id) { return withOrg(pool, orgId, async c => (await c.query('delete from webhooks where org_id = $1 and id = $2', [orgId, Number(id) || 0])).rowCount > 0); }
// tell every active webhook that listens for this event. Never throws; each call has a 5 second limit.
export async function emit(pool, orgId, event, number, extra = {}, { fetchFn = guardedFetch, now = Date.now() } = {}) {
  try {
    const data = await withOrg(pool, orgId, async c => ({
      hooks: (await c.query('select id, url, secret, kind from webhooks where org_id = $1 and active and $2 = any(events)', [orgId, event])).rows,
      t: (await c.query('select custom, number, subject, status, priority, channel, requester_name, requester_email, assignee_id, tags, created_at, updated_at from tickets where org_id = $1 and number = $2', [orgId, Number(number) || 0])).rows[0],
    }));
    if (!data.hooks.length || !data.t) return { sent: 0 };
    const body = JSON.stringify({ event, organization: orgId, occurredAt: new Date(now).toISOString(), ticket: { number: data.t.number, subject: data.t.subject, status: data.t.status, priority: data.t.priority, channel: data.t.channel, requester: { name: data.t.requester_name, email: data.t.requester_email }, assigneeId: data.t.assignee_id, tags: data.t.tags, custom: data.t.custom, createdAt: data.t.created_at, updatedAt: data.t.updated_at }, ...extra });
    const ts = String(Math.floor(now / 1000)), text = chatText(event, data.t, extra);
    await Promise.allSettled(data.hooks.map(async h => {
      let status = 'error';
      try {
        const chat = h.kind === 'slack' || h.kind === 'cliq' ? JSON.stringify({ text }) : h.kind === 'teams' ? JSON.stringify(teamsCard(text)) : null;
        const sig = crypto.createHmac('sha256', h.secret).update(ts + '.' + body).digest('hex');
        const r = await fetchFn(h.url, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: chat ? { 'Content-Type': 'application/json', 'User-Agent': 'EffDesk-Webhook/1' } : { 'Content-Type': 'application/json', 'User-Agent': 'EffDesk-Webhook/1', 'X-EffDesk-Event': event, 'X-EffDesk-Timestamp': ts, 'X-EffDesk-Signature': 'sha256=' + sig }, body: chat || body });
        status = String(r.status);
      } catch (e) { status = e && e.name === 'TimeoutError' ? 'timeout' : 'error'; }
      logInfo('webhook', { org: orgId, kind: h.kind || 'json', status });
      await withOrg(pool, orgId, c => c.query('update webhooks set last_status = $3, last_at = now() where org_id = $1 and id = $2', [orgId, h.id, status])).catch(() => {});
    }));
    return { sent: data.hooks.length };
  } catch (e) { console.warn('webhook error:', e.message); return { sent: 0 }; }
}
