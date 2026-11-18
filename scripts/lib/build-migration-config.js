// Keep build-time migration credentials separate from runtime credentials.
export function resolveBuildMigrationUrl({ context = '', migrationUrl = '' } = {}) {
  if (String(context || '') !== 'production') return null;
  const url = String(migrationUrl || '').trim();
  if (!url) {
    throw new Error('DATABASE_MIGRATION_URL is required for production builds; DATABASE_URL is runtime-only.');
  }
  return url;
}
