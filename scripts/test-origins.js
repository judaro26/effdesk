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
await pool.end(); done(); process.exit(0);
