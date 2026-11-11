// src/license.js: LIFETIME LICENCES granted by the platform owner (for example the first customer, mdv). A licence removes every limit; it is not a subscription and Paddle never touches it.
import { dropEntitlements } from './billing.js';
export async function grantLicense(db, { orgId, actorEmail, note }) {
  const org = await db.query('select id, name from "organization" where id = $1', [orgId]); if (!org.rowCount) return { ok: false, error: 'No such organization.' };
  await db.query(`insert into subscriptions (org_id, license, license_note, license_granted_by, license_granted_at) values ($1, 'lifetime_unlimited', $2, $3, now())
    on conflict (org_id) do update set license = 'lifetime_unlimited', license_note = $2, license_granted_by = $3, license_granted_at = now(), updated_at = now()`, [orgId, String(note || '').slice(0, 200), actorEmail]);
  dropEntitlements(orgId);
  return { ok: true };
}
export async function revokeLicense(db, { orgId }) {
  const r = await db.query(`update subscriptions set license = null, license_note = null, license_granted_by = null, license_granted_at = null, updated_at = now() where org_id = $1 and license is not null`, [orgId]);
  dropEntitlements(orgId);
  return { ok: r.rowCount > 0 };
}
