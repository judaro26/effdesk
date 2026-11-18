// Netlify production builds apply schema migrations with a dedicated migration connection.
// Keep DATABASE_URL least-privileged for runtime functions; set DATABASE_MIGRATION_URL
// to the owner/migration connection with Netlify's "Builds" scope only.
import { migrate } from './migrate.js';
const ctx = process.env.CONTEXT || '';
if (ctx !== 'production') { console.log(`migrate-on-build: skipped (deploy context is "${ctx || 'local'}")`); process.exit(0); }
const migrationUrl = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  console.error('migrate-on-build: DATABASE_MIGRATION_URL (or DATABASE_URL for legacy deployments) is required.');
  process.exit(1);
}
if (!process.env.DATABASE_MIGRATION_URL) {
  console.warn('migrate-on-build: DATABASE_MIGRATION_URL is unset; using DATABASE_URL for legacy compatibility. Configure a build-scoped migration URL and keep DATABASE_URL restricted.');
}
migrate(migrationUrl).then(r => console.log(r.length ? 'migrate-on-build: applied ' + r.join(', ') : 'migrate-on-build: database is up to date'), e => { console.error('migrate-on-build failed:', e.message); process.exit(1); });
