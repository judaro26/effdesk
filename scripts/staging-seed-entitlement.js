// Staging-only feature and seat overrides for synthetic Live Chat benchmark tenants.
// The caller must first validate STAGING_DATABASE_URL against the dedicated staging database.
export async function enableStagingLiveChatOverride(client, orgId, seatLimit = 3) {
  const id = String(orgId || '');
  if (!/^stg_effdesk_org_\d{2}$/.test(id)) {
    throw new Error('Refusing to grant the staging Live Chat override to a non-synthetic workspace.');
  }
  const seats = Number(seatLimit);
  if (!Number.isInteger(seats) || seats < 2 || seats > 20) {
    throw new Error('Staging seat limit must be a whole number from 2 to 20.');
  }
  await client.query(
    `insert into org_overrides (org_id, seat_limit, features_on, updated_by)
     values ($1, $2, array['live_chat']::text[], 'staging-seeder')
     on conflict (org_id) do update set
       seat_limit = greatest(coalesce(org_overrides.seat_limit, 0), excluded.seat_limit),
       features_on = case
         when 'live_chat' = any(org_overrides.features_on) then org_overrides.features_on
         else array_append(org_overrides.features_on, 'live_chat')
       end,
       features_off = array_remove(org_overrides.features_off, 'live_chat'),
       updated_at = now(),
       updated_by = 'staging-seeder'`,
    [id, seats]
  );
}
