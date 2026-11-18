import assert from 'node:assert/strict';
import { resolveBuildMigrationUrl } from './lib/build-migration-config.js';

assert.equal(resolveBuildMigrationUrl({ context: 'deploy-preview' }), null);
assert.equal(resolveBuildMigrationUrl({ context: '' }), null);
assert.equal(resolveBuildMigrationUrl({ context: 'production', migrationUrl: 'postgres://migration@db/app' }), 'postgres://migration@db/app');
assert.throws(
  () => resolveBuildMigrationUrl({ context: 'production', migrationUrl: '' }),
  /DATABASE_MIGRATION_URL is required.*DATABASE_URL is runtime-only/
);
console.log('build migration configuration tests passed');
