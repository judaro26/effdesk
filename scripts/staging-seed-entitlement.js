// Staging-only feature override for synthetic Live Chat benchmark tenants.
// The caller must first validate STAGING_DATABASE_URL against the dedicated staging database.
export async function enableStagingLiveChatOverride(client, orgId) {
  const id = String(orgId || '');
  if (!/^stg_effdesk_org_\\d{2}$/.test(id)) {
    throw new Error('Refusing to grant the staging Live Chat override to a non-synthetic workspace.');
  }
  await client.query(
    `insert into org_overrides (org_id, features_on, updated_by)
     values ($1, array['live_chat']::text[], 'staging-seeder')
     on conflict (org_id) do update set
       features_on = case
         when 'live_chat' = any(org_overrides.features_on) then org_overrides.features_on
         else array_append(org_overrides.features_on, 'live_chat')
       end,
       features_off = array_remove(org_overrides.features_off, 'live_chat'),
       updated_at = now(),
       updated_by = 'staging-seeder'`,
    [id]
  );
}
