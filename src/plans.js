// src/plans.js: WHAT EACH PLAN ALLOWS. Prices are per agent per month. The free plan is 2 agents, forever. A licence (see license.js) lifts every limit.
// Annual prices are about a third of Zendesk's list (Support Team $19, Suite Team $55, Suite Professional $115); monthly billing costs a quarter more.
export const SEAT_ROLES = ['owner', 'admin', 'member'];          // every member of an organization is an agent and uses a seat; light agents come later
export const FREE_SEATS = 2;
export const INTERVALS = ['month', 'year'];

const BASE = ['tickets', 'email_channel', 'macros', 'help_center_basic', 'csat_basic'];
const TEAM = [...BASE, 'themes', 'queues', 'clients', 'linked_tickets', 'saved_views', 'sla', 'triggers', 'reports', 'csat', 'integrations'];
const SUITE = [...TEAM, 'side_conversations', 'help_center', 'live_chat', 'translation', 'ai_assist', 'custom_fields'];
const PRO = [...SUITE, 'custom_roles', 'audit_log', 'sso', 'data_export', 'sandbox', 'two_factor_enforcement'];

export const PLANS = {
  free: { name: 'Free', price: { month: 0, year: 0 }, includedSeats: FREE_SEATS, features: BASE },
  team: { name: 'Team', price: { month: 8, year: 6 }, includedSeats: 0, features: TEAM },
  suite: { name: 'Suite', price: { month: 23, year: 18 }, includedSeats: 0, features: SUITE },
  pro: { name: 'Pro', price: { month: 49, year: 39 }, includedSeats: 0, features: PRO },
};
export const ALL_FEATURES = [...new Set(PRO)];
export const PAID_PLANS = ['team', 'suite', 'pro'];

// A subscription row (or null) → what the organization may do.
//   Paid and in good standing (active, trialing, past_due: a short grace while the card is retried) → the plan with the seats paid for.
//   Anything else (none, paused, canceled) → Free.   A lifetime licence beats everything.
export function entitlements(sub) {
  if (sub && sub.license === 'lifetime_unlimited') return { plan: 'pro', license: 'lifetime_unlimited', seats: Infinity, features: new Set(ALL_FEATURES), paid: false };
  const good = sub && ['active', 'trialing', 'past_due'].includes(sub.status) && PAID_PLANS.includes(sub.plan) && Number(sub.seats_paid) > 0;
  if (!good) return { plan: 'free', license: null, seats: FREE_SEATS, features: new Set(PLANS.free.features), paid: false };
  return { plan: sub.plan, license: null, seats: Number(sub.seats_paid), features: new Set(PLANS[sub.plan].features), paid: true, interval: sub.interval || null };
}
export const has = (ent, feature) => ent.features.has(feature);
// can one more agent be added? (used = members + pending invitations)
export function seatCheck(ent, used) {
  const ok = used < ent.seats;
  return { ok, used, limit: ent.seats === Infinity ? null : ent.seats, plan: ent.plan, reason: ok ? '' : ent.plan === 'free' ? `The free plan includes ${FREE_SEATS} agents. Upgrade to add more.` : `All ${ent.seats} paid agent seats are in use. Add seats to invite more people.` };
}
export const priceOf = (plan, interval, seats) => (PLANS[plan] ? PLANS[plan].price[interval] * seats : 0);

// outgoing ticket emails an organization may send per rolling 24 hours (stops a stolen account from being used to send spam)
export const MAIL_PER_DAY = { free: 50, team: 500, suite: 2000, pro: 5000 };
export const mailLimit = ent => MAIL_PER_DAY[ent.plan] || MAIL_PER_DAY.free;
