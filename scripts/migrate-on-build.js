// scripts/migrate-on-build.js: runs as Netlify's build command, so the database is updated by each PRODUCTION deploy and nobody needs a terminal.
// Deploy previews and branch deploys skip it (they must never touch the production database). A failed migration fails the deploy, so the old version keeps serving.
import { migrate } from './migrate.js';
const ctx = process.env.CONTEXT || '';
if (ctx !== 'production') { console.log(`migrate-on-build: skipped (deploy context is "${ctx || 'local'}")`); process.exit(0); }
if (!process.env.DATABASE_URL) { console.error('migrate-on-build: DATABASE_URL is not set in the Netlify environment variables.'); process.exit(1); }
migrate(process.env.DATABASE_URL).then(r => console.log(r.length ? 'migrate-on-build: applied ' + r.join(', ') : 'migrate-on-build: database is up to date'), e => { console.error('migrate-on-build failed:', e.message); process.exit(1); });
