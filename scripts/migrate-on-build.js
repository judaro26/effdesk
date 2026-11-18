// Netlify production builds apply schema migrations with a dedicated migration connection.
// DATABASE_URL is runtime-only and must never be used as a migration fallback.
import { migrate } from './migrate.js';
import { resolveBuildMigrationUrl } from './lib/build-migration-config.js';

let migrationUrl;
try {
  migrationUrl = resolveBuildMigrationUrl({
    context: process.env.CONTEXT || '',
    migrationUrl: process.env.DATABASE_MIGRATION_URL || ''
  });
} catch (error) {
  console.error('migrate-on-build:', error.message);
  process.exit(1);
}

if (!migrationUrl) {
  console.log(`migrate-on-build: skipped (deploy context is "${process.env.CONTEXT || 'local'}")`);
  process.exit(0);
}

migrate(migrationUrl).then(
  r => console.log(r.length ? 'migrate-on-build: applied ' + r.join(', ') : 'migrate-on-build: database is up to date'),
  e => { console.error('migrate-on-build failed:', e.message); process.exit(1); }
);
