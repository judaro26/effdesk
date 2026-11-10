// src/auth.js: EFFDESK'S OWN SIGN-IN (Better Auth, self-hosted; users, sessions and organizations live in our Neon database, nothing is shared with any other product).
//   email + password (the address must be confirmed), password reset, two-factor (authenticator app), organizations with invitations.
//   Every person in an organization is an agent and uses a seat: inviting or adding one over the plan's limit is refused here (src/billing.js checkSeat).
import { betterAuth } from 'better-auth';
import { organization, twoFactor } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { PRODUCT } from './config.js';
import { checkSeat } from './billing.js';
import { ssoPlugin } from './sso.js';
import { AsyncLocalStorage } from 'node:async_hooks';

// the company a person typed at registration, handed to the confirmation email that Better Auth sends in the middle of the sign-up call
export const signupContext = new AsyncLocalStorage();

export function authOptions({ pool, mailer, secret = process.env.BETTER_AUTH_SECRET, baseURL = PRODUCT.appUrl, requireVerified = process.env.REQUIRE_EMAIL_VERIFICATION !== 'false', cookieDomain = process.env.COOKIE_DOMAIN || '' }) {
  const seatGuard = async orgId => { const s = await checkSeat(pool, orgId); if (!s.ok) throw new APIError('FORBIDDEN', { message: s.reason, code: 'SEATS_FULL' }); };
  return {
    appName: PRODUCT.name, baseURL, basePath: '/api/auth', secret, database: pool,
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, requireEmailVerification: requireVerified, autoSignIn: !requireVerified, sendResetPassword: async ({ user, url }) => { await mailer.reset(user.email, url); } },
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: true, sendVerificationEmail: async ({ user, token }) => { const row = (await pool.query('select company from pending_signups where user_id = $1', [user.id]).catch(() => ({ rows: [] }))).rows[0]; await mailer.verify(user.email, `${baseURL}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${encodeURIComponent('/welcome.html')}`, { company: (signupContext.getStore() && signupContext.getStore().company) || (row && row.company), name: String(user.name || '').split(' ')[0] }); } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: /^https:/.test(baseURL), defaultCookieAttributes: { sameSite: 'lax', httpOnly: true }, ...(cookieDomain ? { crossSubDomainCookies: { enabled: true, domain: cookieDomain } } : {}) },
    // with a cookie domain set (for example .effdesk.com) every workspace address (acme.effdesk.com) shares the one sign-in
    trustedOrigins: [...(cookieDomain ? ['https://*' + cookieDomain] : []), ...(process.env.ORIGIN_HOST ? ['https://' + process.env.ORIGIN_HOST] : [])],
    rateLimit: { enabled: true, window: 60, max: 60, storage: 'database', customRules: { '/sign-in/email': { window: 60, max: 8 }, '/sign-up/email': { window: 60, max: 5 }, '/request-password-reset': { window: 300, max: 5 } } },
    plugins: [
      ssoPlugin({ pool, env: { BETTER_AUTH_SECRET: secret }, baseURL }),
      twoFactor({ issuer: PRODUCT.name }),
      organization({
        allowUserToCreateOrganization: true, organizationLimit: 5, membershipLimit: 500, invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async data => { await mailer.invite(data.email, `${baseURL}/accept-invitation?id=${encodeURIComponent(data.id)}`, data.inviter.user.name || data.inviter.user.email, data.organization.name); },
        organizationHooks: {
          beforeCreateInvitation: async ({ invitation }) => { await seatGuard(invitation.organizationId); },
          beforeAddMember: async ({ member }) => { await seatGuard(member.organizationId); },
        },
      }),
    ],
  };
}
export const makeAuth = opts => betterAuth(authOptions(opts));
