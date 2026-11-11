// scripts/profile-queries.js: RICH HELP ARTICLES: safe HTML, pictures, video, PDF import, categories, themes, and the redesigned help center ON A REAL POSTGRES: error tracking and alerts, browser error reports, health, the status page and its management, per-customer settings and suspension, the announcement banner, the signup switch, user lookup, and the audit log.
import crypto from 'crypto';
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import { helpAssets, helpCenter, tickets, adminDo, clientLog, health, statusPublic, me, signup } from '../src/handlers.js';
import { recordError, fingerprint } from '../src/errors.js';
import { logged, sinks } from '../src/log.js';
import { resetCache } from '../src/platform-settings.js';
import { createTicket } from '../src/tickets.js';
import { memoryStore } from '../src/storage.js';
import fs from 'fs';
import { grantLicense } from '../src/license.js';

const SECRET = crypto.randomBytes(32).toString('base64'), PW = 'correct horse battery';
const ENV = { INBOUND_DOMAIN: 'in.effdesk.test', BETTER_AUTH_SECRET: SECRET, RESEND_API_KEY: 're_test', AXIOM_TOKEN: 'xaat-test', AXIOM_DATASET: 'effdesk' };
const { url } = await freshDb('ai'); await migrate(url);
const pool = makePool(url), outbox = [];
const mailer = makeMailer({ transport: async m => { outbox.push(m); } });
const auth = makeAuth({ pool, mailer, secret: SECRET, baseURL: 'http://localhost:8888', requireVerified: false });
const signUp = async (email, name) => { await auth.api.signUpEmail({ body: { email, password: PW, name } }); const r = await auth.api.signInEmail({ body: { email, password: PW }, returnHeaders: true }); const cookie = r.headers.getSetCookie().map(c => c.split(';')[0]).join('; '); return { cookie, user: r.response.user, headers: new Headers({ cookie }) }; };

const olivia = await signUp('olivia@acme.test', 'Olivia'), ann = await signUp('ann@acme.test', 'Ann');
const acme = await auth.api.createOrganization({ body: { name: 'Acme', slug: 'acme' }, headers: olivia.headers });
await auth.api.addMember({ body: { userId: ann.user.id, role: 'member', organizationId: acme.id } });
await grantLicense(pool, { orgId: acme.id, actorEmail: 'owner@effdesk.test', note: 'test' });


const A = async (who, action, extra = {}) => { const r = await tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), { pool, auth, mailer, env: ENV }); return { status: r.status, body: await r.json() }; };



import pg from 'pg';
let q = 0; const oq = pg.Client.prototype.query; pg.Client.prototype.query = function (...a) { q++; if (process.env.SHOW) console.log('  ', String(a[0] && a[0].text || a[0]).replace(/\s+/g,' ').slice(0, 110)); return oq.apply(this, a); };
const store = memoryStore(), CTX = { pool, auth, mailer, store, env: ENV };
const T = (who, action, extra = {}) => tickets(new Request('http://x/api/tickets', { method: 'POST', headers: { 'content-type': 'application/json', cookie: who.cookie }, body: JSON.stringify({ orgId: acme.id, action, ...extra }) }), CTX);
const M = who => me(new Request('http://x/api/me', { headers: { cookie: who.cookie } }), CTX);
const count = async (label, fn) => { q = 0; const t = Date.now(); await fn(); console.log(label.padEnd(24), 'queries:', q, ' ms:', Date.now() - t); };
await T(olivia, 'init'); await M(olivia);
await count('api/me', () => M(olivia));
await count('tickets init', () => T(olivia, 'init'));
await count('tickets list', () => T(olivia, 'list', {}));
await count('help home', () => helpCenter(new Request('https://x.test/help/acme'), CTX));
process.exit(0);
