// src/auth.js: EFFDESK'S OWN SIGN-IN (Better Auth, self-hosted; users, sessions and organizations live in our Neon database, nothing is shared with any other product).
//   email + password (the address must be confirmed), password reset, two-factor (authenticator app), organizations with invitations.
//   Every person in an organization is an agent and uses a seat: inviting or adding one over the plan's limit is refused here (src/billing.js checkSeat).
import { betterAuth } from 'better-auth';
import { organization, twoFactor } from 'better-auth/plugins';
import { APIError } from 'better-auth/api';
import { PRODUCT } from './config.js';
import { checkSeat } from './billing.js';

export function authOptions({ pool, mailer, secret = process.env.BETTER_AUTH_SECRET, baseURL = PRODUCT.appUrl, requireVerified = process.env.REQUIRE_EMAIL_VERIFICATION !== 'false' }) {
  const seatGuard = async orgId => { const s = await checkSeat(pool, orgId); if (!s.ok) throw new APIError('FORBIDDEN', { message: s.reason, code: 'SEATS_FULL' }); };
  return {
    appName: PRODUCT.name, baseURL, basePath: '/api/auth', secret, database: pool,
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, requireEmailVerification: requireVerified, autoSignIn: !requireVerified, sendResetPassword: async ({ user, url }) => { await mailer.reset(user.email, url); } },
    emailVerification: { sendOnSignUp: true, autoSignInAfterVerification: true, sendVerificationEmail: async ({ user, url }) => { await mailer.verify(user.email, url); } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    advanced: { useSecureCookies: /^https:/.test(baseURL), defaultCookieAttributes: { sameSite: 'lax', httpOnly: true } },
    rateLimit: { enabled: true, window: 60, max: 60, storage: 'database', customRules: { '/sign-in/email': { window: 60, max: 8 }, '/sign-up/email': { window: 60, max: 5 }, '/request-password-reset': { window: 300, max: 5 } } },
    plugins: [
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
