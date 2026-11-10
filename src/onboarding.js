// src/onboarding.js: REGISTRATION → CONFIRM EMAIL → PICK A PLAN → WORKSPACE. A person registers with a company name and the workspace address they want (checked against every address already used or held); the confirmation link brings them to a page where they choose a plan; choosing creates their workspace.
import { saveMailSettings, suggestInbox } from './ticket-mail.js';
import { grantLicense } from './license.js';

export const HOLD_DAYS = 7;
// OWNER_WORKSPACES="mdv:you@company.com,other:someone@x.com": an address that belongs to one email. Nobody else can register it, and when that person creates it the workspace gets the lifetime licence at once.
export const ownerWorkspaces = (env = process.env) => Object.fromEntries(String(env.OWNER_WORKSPACES || '').split(',').map(x => x.trim().toLowerCase()).filter(x => x.indexOf(':') > 0).map(x => [x.slice(0, x.indexOf(':')), x.slice(x.indexOf(':') + 1)]));
const RESERVED = new Set(['www', 'app', 'api', 'admin', 'help', 'mail', 'in', 'smtp', 'imap', 'pop', 'ftp', 'status', 'blog', 'docs', 'support', 'billing', 'sales', 'login', 'signin', 'signup', 'auth', 'account', 'static', 'assets', 'cdn', 'mx', 'ns', 'ns1', 'ns2', 'effdesk', 'root', 'test', 'demo', 'staging', 'dev', 'security', 'abuse', 'postmaster', 'webmaster', 'legal', 'privacy', 'terms', 'about', 'pricing', 'internal', 'system']);
export const normalizeSlug = v => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
const SLUG_OK = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
export const cleanCompany = v => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

// is this workspace address free? Taken by an organization, held by someone who has registered but not finished (for 7 days), or reserved for us.
export async function slugStatus(pool, raw, { exceptUserId = null, email = '', env = process.env } = {}) {
  const slug = normalizeSlug(raw);
  if (slug.length < 3) return { available: false, slug, reason: 'Use at least 3 letters or numbers.' };
  if (slug.length > 40 || !SLUG_OK.test(slug)) return { available: false, slug, reason: 'Use 3 to 40 letters, numbers or dashes.' };
  if (RESERVED.has(slug)) return { available: false, slug, reason: 'That address is reserved. Choose another.' };
  const owner = ownerWorkspaces(env)[slug]; if (owner && owner !== String(email || '').trim().toLowerCase()) return { available: false, slug, reason: 'That address is reserved. Choose another.' };
  if ((await pool.query('select 1 from "organization" where slug = $1', [slug])).rowCount) return { available: false, slug, reason: 'That address is already taken.' };
  if ((await pool.query(`select 1 from pending_signups where slug = $1 and created_at > now() - ($2 || ' days')::interval and ($3::text is null or user_id <> $3)`, [slug, String(HOLD_DAYS), exceptUserId])).rowCount) return { available: false, slug, reason: 'That address is already taken.' };
  return { available: true, slug };
}
export async function holdSlug(pool, userId, company, slug) {
  try {
    await pool.query(`delete from pending_signups where created_at <= now() - ($1 || ' days')::interval`, [String(HOLD_DAYS)]);
    await pool.query('insert into pending_signups (user_id, company, slug) values ($1,$2,$3) on conflict (user_id) do update set company = excluded.company, slug = excluded.slug, created_at = now()', [userId, company, slug]);
    return true;
  } catch (e) { if (e.code === '23505') return false; throw e; }
}
export const pendingOf = async (pool, userId) => (await pool.query(`select company, slug from pending_signups where user_id = $1`, [userId])).rows[0] || null;

// create the workspace the person asked for (an organization, with its support address and defaults). Safe to call twice.
export async function createWorkspace(pool, auth, headers, user, env = process.env) {
  const pend = await pendingOf(pool, user.id);
  if (!pend) {
    const mine = (await pool.query('select o.id, o.slug, o.name from member m join "organization" o on o.id = m."organizationId" where m."userId" = $1 order by m."createdAt" limit 1', [user.id])).rows[0];
    return mine ? { ok: true, existing: true, org: mine } : { ok: false, status: 404, error: 'There is no workspace waiting to be created. Create an organization from your account page.' };
  }
  const st = await slugStatus(pool, pend.slug, { exceptUserId: user.id, email: user.email, env });
  if (!st.available) return { ok: false, status: 409, taken: true, error: 'That workspace address was taken before you finished. Choose another.' };
  const org = await auth.api.createOrganization({ body: { name: pend.company, slug: pend.slug }, headers });
  await pool.query('delete from pending_signups where user_id = $1', [user.id]);
  if (ownerWorkspaces(env)[pend.slug] === String(user.email).toLowerCase()) await grantLicense(pool, { orgId: org.id, actorEmail: 'owner-workspaces', note: 'Our own workspace (OWNER_WORKSPACES)' });
  const inbox = suggestInbox(pend.slug);
  if (/^[a-z0-9][a-z0-9-]{2,31}$/.test(inbox)) await saveMailSettings(pool, org.id, { inbox, replyMode: 'ticket', fromName: pend.company }, env).catch(() => null);          // the support address is claimed when still free; the owner can change it later
  return { ok: true, existing: false, org: { id: org.id, slug: org.slug, name: org.name } };
}
// a different address, when the held one was taken: the person is still signed in, so they pick again
export async function changePending(pool, userId, raw, env = process.env) {
  const email = (await pool.query('select email from "user" where id = $1', [userId])).rows[0]?.email || '';
  const st = await slugStatus(pool, raw, { exceptUserId: userId, email, env }); if (!st.available) return { ok: false, ...st };
  const r = await pool.query('update pending_signups set slug = $2, created_at = now() where user_id = $1', [userId, st.slug]);
  return r.rowCount ? { ok: true, slug: st.slug } : { ok: false, reason: 'There is no workspace waiting.' };
}
