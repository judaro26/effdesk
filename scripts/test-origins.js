// scripts/test-origins.js: SIGN-IN IS TRUSTED FROM THE SITE'S OWN ADDRESSES (apex, www, app) AND REFUSED FROM ANY OTHER ORIGIN.
import { check, done } from './lib/check.js';
import { freshDb } from './lib/pg-temp.js';
import { migrate } from './migrate.js';
import { makePool } from '../src/db.js';
import { makeAuth, siteOrigins } from '../src/auth.js';
import { makeMailer } from '../src/email.js';
import crypto from 'crypto';
const { url } = await freshDb('origins'); await migrate(url);
const pool = makePool(url), mailer = makeMailer({ transport: async () => {} });
const auth = makeAuth({ pool, mailer, secret: crypto.randomBytes(32).toString('base64'), baseURL: 'https://app.effdesk.test', requireVerified: false });
check('the apex, www and app addresses are derived from the app address', siteOrigins('https://app.effdesk.com').join() === 'https://effdesk.com,https://www.effdesk.com,https://app.effdesk.com' && siteOrigins('http://localhost:8888').length === 0);
const signIn = async origin => (await auth.handler(new Request('https://app.effdesk.test/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email: 'nobody@x.test', password: 'wrong password here' }) }))).json();
const apex = await signIn('https://effdesk.test'), app = await signIn('https://app.effdesk.test'), evil = await signIn('https://evil.test');
check('sign-in from the apex address reaches the password check, not the origin check', apex.code === 'INVALID_EMAIL_OR_PASSWORD');
check('sign-in from the app address works as before', app.code === 'INVALID_EMAIL_OR_PASSWORD');
check('another site is refused', evil.code === 'INVALID_ORIGIN');

// the app address setting may name something else entirely (or be missing): the workspace domain setting still makes the apex and www trusted
import { trustedFor } from '../src/auth.js';
const t = trustedFor({ DESK_BASE_DOMAIN: 'effdesk.test' }, 'http://localhost:8888');
check('the settings that name the site give the apex, www, app and every workspace address', ['https://effdesk.test', 'https://www.effdesk.test', 'https://app.effdesk.test', 'https://*.effdesk.test'].every(o => t.includes(o)) && trustedFor({}, 'http://localhost:8888').length === 0);
process.env.DESK_BASE_DOMAIN = 'effdesk.test';
const auth2 = makeAuth({ pool, mailer, secret: crypto.randomBytes(32).toString('base64'), baseURL: 'http://localhost:8888', requireVerified: false });
const apex2 = (await auth2.handler(new Request('http://localhost:8888/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://effdesk.test' }, body: JSON.stringify({ email: 'nobody@x.test', password: 'wrong password' }) }))), j2 = await apex2.json().catch(() => ({}));
check('sign-in from the apex works even when the app address setting does not name the site', j2.code === 'INVALID_EMAIL_OR_PASSWORD');
delete process.env.DESK_BASE_DOMAIN;
await pool.end(); done(); process.exit(0);
