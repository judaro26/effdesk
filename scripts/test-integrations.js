// scripts/test-integrations.js: PROFILE PICTURES, @MENTIONS AND OUTBOUND WEBHOOKS ON A REAL POSTGRES.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { tickets, inboundEmail } from '../src/handlers.js';
import { grantLicense } from '../src/license.js';
import { ticketToken } from '../src/ticket-mail.js';
import { emit, safeUrl } from '../src/webhooks.js';
import { connectIntegration, listIntegrationConnections, testIntegrationConnection, disconnectIntegration } from '../src/integration-hub.js';
import { validAvatar } from '../src/avatar.js';
import { handlesIn } from '../src/mentions.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery', WH = 'whsec_' + crypto.randomBytes(24).toString('base64');
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_WEBHOOK_SECRET: WH, RESEND_API_KEY: 're_test' };
const { url } = await freshDb('integr'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.get('set-cookie').split(/,(?=[^;]+=)/).map(c => c.split(';')[0]).join('; '); return { cookie, headers: new Headers({ cookie }), user: r.response.user }; };
const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann'), otto = await signUp('otto@beta.test', 'Otto');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
const beta = await auth.api.createOrganization({ body: { name: 'Beta', slug: 'beta' }, headers: otto.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });
const call = async (who, body) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify(body) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };
const A = (who, action, extra = {}) => call(who, { orgId: acme.id, action, ...extra }), B = (who, action, extra = {}) => call(who, { orgId: beta.id, action, ...extra });
const PNG = 'data:image/png;base64,' + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(40)]).toString('base64');
check('a picture must be a small PNG, JPEG or WebP by its first bytes', validAvatar(PNG) && !validAvatar('data:image/svg+xml;base64,PHN2Zz4=') && !validAvatar('data:image/png;base64,' + Buffer.from('<script>').toString('base64')) && !validAvatar('javascript:alert(1)') && !validAvatar(PNG + 'A'.repeat(70000)));
check('saving a picture works, shows in init for me and for my teammates, and can be removed', (await A(ann, 'prefs-save', { avatar: PNG })).body.avatar === PNG && (await A(ann, 'init')).body.avatar === PNG && (await A(olivia, 'init')).body.agents.find(a => a.email === 'ann@acme.test').avatar === PNG && (await A(ann, 'prefs-save', { avatar: null })).body.avatar === null && (await A(ann, 'init')).body.avatar === null);
check('a bad picture is refused with an explanation', (await A(ann, 'prefs-save', { avatar: 'data:image/png;base64,AAAA' })).status === 400);
await A(ann, 'prefs-save', { avatar: PNG }); await A(ann, 'prefs-save', { theme: 'midnight' });
check('saving a theme later does not wipe the picture', (await A(ann, 'init')).body.avatar === PNG);
const savedTicketPrefs = await A(ann, 'ticket-prefs-save', {
  filters: { status: 'active', q: 'heater', columnFilters: { priority: 'urgent', requester: 'Tina', number: '12', invalid: 'ignored' } },
  columns: ['status', 'subject', 'priority']
});
const annTicketPrefs = (await A(ann, 'init')).body.ticketPrefs;
const oliviaTicketPrefs = (await A(olivia, 'init')).body.ticketPrefs;
check('ticket filters and visible columns persist per agent across init/session reloads', savedTicketPrefs.status === 200 && annTicketPrefs.filters.q === 'heater' && annTicketPrefs.filters.columnFilters.priority === 'urgent' && annTicketPrefs.filters.columnFilters.requester === 'Tina' && annTicketPrefs.columns.join() === 'status,subject,priority' && oliviaTicketPrefs.filters.q === '' && oliviaTicketPrefs.columns.includes('number'));
await B(otto, 'ticket-prefs-save', { filters: { status: 'solved', q: 'beta' }, columns: ['number', 'updated'] });
check('ticket preferences are isolated by both organization and agent', (await A(ann, 'init')).body.ticketPrefs.filters.q === 'heater' && (await B(otto, 'init')).body.ticketPrefs.filters.q === 'beta');
check('invalid ticket filter values are discarded and an empty column layout is refused', (await A(ann, 'ticket-prefs-save', { filters: { status: 'javascript', columnFilters: { priority: 'root' } }, columns: [] })).status === 400 && (await A(ann, 'ticket-prefs-save', { filters: { status: 'javascript', columnFilters: { priority: 'root' } }, columns: ['status'] })).status === 200 && (await A(ann, 'init')).body.ticketPrefs.filters.status === 'active' && !('priority' in (await A(ann, 'init')).body.ticketPrefs.filters.columnFilters));


check('handles are read from the text', JSON.stringify(handlesIn('hi @Ann, cc (@olivia) and a@b.com @ann.')) === JSON.stringify(['ann', 'olivia']));
const t1 = (await A(olivia, 'create', { subject: 'Boiler', body: 'cold', requesterEmail: 'tina@example.com' })).body.ticket;
outbox.length = 0; const note = await A(olivia, 'note', { number: t1.number, body: 'Can you look, @ann? Not @nobody.' });
const mails = outbox.filter(m => /mentioned/.test(m.subject));
check('mentioning a teammate in an internal note emails them, once, and nobody else', note.body.mentioned === 1 && mails.length === 1 && mails[0].to === 'ann@acme.test' && /You were mentioned in an internal note: #1 Boiler/.test(mails[0].subject));
outbox.length = 0; await A(olivia, 'note', { number: t1.number, body: 'note to self @olivia' });
check('mentioning yourself sends nothing', outbox.filter(m => /mentioned/.test(m.subject)).length === 0);

check('webhook addresses must be public https', safeUrl('https://hooks.example.org/x') !== null && ['http://hooks.example.org/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://svc.internal/x', 'https://u:p@hooks.example.org/x', 'https://hooks.example.org:8443/x', 'ftp://a.b.org/x'].every(u => safeUrl(u) === null));
check('only an admin on a plan with integrations can manage webhooks', (await A(ann, 'webhook-save', { url: 'https://hooks.example.org/x', events: ['ticket.created'] })).status === 403 && (await B(otto, 'webhook-save', { url: 'https://hooks.example.org/x', events: ['ticket.created'] })).status === 402);
const saved = await A(olivia, 'webhook-save', { url: 'https://hooks.example.org/x', events: ['ticket.created', 'message.customer', 'nonsense'] });
check('adding a webhook gives the signing secret once and the list never shows it', saved.status === 200 && /^whsec_/.test(saved.body.secret) && !JSON.stringify((await A(olivia, 'webhooks-list')).body).includes(saved.body.secret) && (await A(olivia, 'webhooks-list')).body.webhooks[0].events.length === 2);
check('a webhook needs an event and a good address', (await A(olivia, 'webhook-save', { url: 'https://hooks.example.org/x', events: [] })).status === 400 && (await A(olivia, 'webhook-save', { url: 'http://x.org', events: ['ticket.created'] })).status === 400);
const sent = []; const fake = async (u, init) => { sent.push({ u, init }); return { status: 200 }; };
const r1 = await emit(pool, acme.id, 'ticket.created', t1.number, {}, { fetchFn: fake, now: 1700000000000 });
const hit = sent[0], bodyText = hit && hit.init.body, expect = crypto.createHmac('sha256', saved.body.secret).update('1700000000.' + bodyText).digest('hex');
check('an event is posted to the listener, signed so it can be checked, and the result is recorded', r1.sent === 1 && hit.u === 'https://hooks.example.org/x' && hit.init.headers['X-EffDesk-Signature'] === 'sha256=' + expect && hit.init.headers['X-EffDesk-Event'] === 'ticket.created' && JSON.parse(bodyText).ticket.subject === 'Boiler' && hit.init.redirect === 'manual' && (await A(olivia, 'webhooks-list')).body.webhooks[0].last_status === '200');
sent.length = 0; await emit(pool, acme.id, 'ticket.updated', t1.number, {}, { fetchFn: fake });
check('an event nobody listens for sends nothing', sent.length === 0);
const bad = await emit(pool, acme.id, 'ticket.created', t1.number, {}, { fetchFn: async () => { throw new Error('down'); } });
check('a listener that is down never breaks the desk, and shows as an error', bad.sent === 1 && (await A(olivia, 'webhooks-list')).body.webhooks[0].last_status === 'error');
check('another organization cannot see or delete these webhooks', (await B(otto, 'webhooks-list')).status === 402 && (await A(olivia, 'webhook-delete', { id: 999 })).status === 404);
check('a webhook can be deleted', (await A(olivia, 'webhook-delete', { id: saved.body.id })).status === 200 && (await A(olivia, 'webhooks-list')).body.webhooks.length === 0);
const githubToken = 'ghp_test_token_that_is_never_returned';
const githubFetch = async (url, init) => {
  check('GitHub token verification uses a fixed provider endpoint and bearer authorization', url === 'https://api.github.com/user' && init.headers.authorization === 'Bearer ' + githubToken && init.redirect === 'error');
  return new Response(JSON.stringify({ id: 123, login: 'acme-engineering', name: 'Acme Engineering' }), { status: 200, headers: { 'x-oauth-scopes': 'read:user' } });
};
const gh = await connectIntegration(pool, ENV, acme.id, olivia.user.id, 'github', { token: githubToken }, { fetchFn: githubFetch });
const ghList = await A(olivia, 'integration-hub-list');
const ghStored = (await pool.query('select credentials_enc from integration_connections where org_id=$1 and provider=$2', [acme.id, 'github'])).rows[0];
check('GitHub credentials are verified, encrypted at rest, and only safe connection metadata is listed', gh.ok && gh.accountUsername === 'acme-engineering' && ghList.status === 200 && ghList.body.connections[0].provider === 'github' && ghList.body.connections[0].account_username === 'acme-engineering' && !JSON.stringify(ghList.body).includes(githubToken) && ghStored.credentials_enc !== githubToken && !ghStored.credentials_enc.includes(githubToken));
const ghTest = await testIntegrationConnection(pool, ENV, acme.id, 'github', { fetchFn: githubFetch });
check('GitHub connection health can be retested without exposing its token', ghTest.ok && ghTest.accountUsername === 'acme-engineering' && (await A(olivia, 'integration-hub-list')).body.connections[0].status === 'connected');
const gitlabToken = 'glpat_test_token_that_is_never_returned';
const gl = await connectIntegration(pool, ENV, acme.id, olivia.user.id, 'gitlab', { token: gitlabToken }, { fetchFn: async (url, init) => url === 'https://gitlab.com/api/v4/user' && init.headers.authorization === 'Bearer ' + gitlabToken ? new Response(JSON.stringify({ id: 456, username: 'acme-dev', name: 'Acme Dev' }), { status: 200, headers: { 'x-oauth-scopes': 'read_user' } }) : new Response('{}', { status: 401 }) });
check('GitLab tokens are verified against the fixed GitLab profile endpoint', gl.ok && gl.accountUsername === 'acme-dev');
const rejected = await connectIntegration(pool, ENV, acme.id, olivia.user.id, 'github', { token: 'ghp_invalid_token_for_test' }, { fetchFn: async () => new Response('{}', { status: 401 }) });
check('invalid GitHub tokens are refused and are not saved', !rejected.ok && (await listIntegrationConnections(pool, acme.id)).connections.length === 2);
const isolated = await listIntegrationConnections(pool, beta.id);
check('integration connections are isolated between customer organizations', isolated.connections.length === 0);
check('only workspace admins can view or manage provider credentials', (await A(ann, 'integration-hub-list')).status === 403 && (await B(otto, 'integration-hub-list')).status === 402);
const degraded = await testIntegrationConnection(pool, ENV, acme.id, 'github', { fetchFn: async () => new Response('{}', { status: 403 }) });
check('failed provider health checks mark the connection degraded without deleting credentials', !degraded.ok && (await A(olivia, 'integration-hub-list')).body.connections.find(x => x.provider === 'github').status === 'degraded');
check('disconnect removes the stored GitHub credential and leaves GitLab intact', (await disconnectIntegration(pool, acme.id, 'github')).ok && (await listIntegrationConnections(pool, acme.id)).connections.length === 1);

const sl = await A(olivia, 'webhook-save', { kind: 'slack', url: 'https://hooks.slack.com/services/T000/B000/XXXX', events: ['ticket.created'] });
check('a Slack webhook only accepts Slack addresses, and has no secret', sl.status === 200 && sl.body.secret === undefined && (await A(olivia, 'webhook-save', { kind: 'slack', url: 'https://evil.example.org/x', events: ['ticket.created'] })).status === 400 && (await A(olivia, 'webhook-save', { kind: 'teams', url: 'https://evil.example.org/x', events: ['ticket.created'] })).status === 400);
const tm = await A(olivia, 'webhook-save', { kind: 'teams', url: 'https://contoso.webhook.office.com/webhookb2/abc', events: ['ticket.created'] });
const chatSent = []; await emit(pool, acme.id, 'ticket.created', t1.number, {}, { fetchFn: async (u, init) => { chatSent.push({ u, init }); return { status: 200 }; } });
const slackMsg = chatSent.find(x => /slack/.test(x.u)), teamsMsg = chatSent.find(x => /office/.test(x.u));
check('Slack gets a short text message without our signature; Teams gets a card', tm.status === 200 && /New ticket: #1 Boiler/.test(JSON.parse(slackMsg.init.body).text) && !slackMsg.init.headers['X-EffDesk-Signature'] && JSON.parse(teamsMsg.init.body).attachments[0].contentType === 'application/vnd.microsoft.card.adaptive' && /Boiler/.test(teamsMsg.init.body));
const cliq = await A(olivia, 'webhook-save', { kind: 'cliq', url: 'https://cliq.zoho.com/api/v2/channelsbyname/support/message?zapikey=example-secret', events: ['ticket.created'] });
const cliqSent = []; await emit(pool, acme.id, 'ticket.created', t1.number, {}, { fetchFn: async (u, init) => { cliqSent.push({ u, init }); return { status: 200 }; } });
check('Zoho Cliq accepts only regional Cliq webhook hosts and receives ticket notifications', cliq.status === 200 && cliqSent.some(x => /cliq\.zoho\.com/.test(x.u) && /New ticket: #1 Boiler/.test(JSON.parse(x.init.body).text)) && (await A(olivia, 'webhook-save', { kind: 'cliq', url: 'https://evil.example.org/hook', events: ['ticket.created'] })).status === 400);
done();
