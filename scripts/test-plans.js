// scripts/test-plans.js: WHAT EACH PLAN ALLOWS (src/plans.js): the free two seats, paid seats, grace, licences and the price list.
import { check, done } from './lib/check.js';
import { entitlements, seatCheck, has, PLANS, FREE_SEATS, ALL_FEATURES, priceOf } from '../src/plans.js';

const free = entitlements(null);
check('with no subscription an organization is on the free plan with 2 agents', free.plan === 'free' && free.seats === 2 && FREE_SEATS === 2 && free.paid === false);
check('free has tickets, email and macros, and none of the paid features', has(free, 'tickets') && has(free, 'macros') && !has(free, 'sla') && !has(free, 'translation') && !has(free, 'sso'));
check('the free plan fits 2 agents and refuses the third, with a reason that says how to fix it', seatCheck(free, 1).ok && !seatCheck(free, 2).ok && /free plan includes 2 agents/.test(seatCheck(free, 2).reason));
const team = entitlements({ plan: 'team', status: 'active', seats_paid: 5, interval: 'year' });
check('a paid plan allows exactly the seats paid for, and its features', team.plan === 'team' && team.seats === 5 && seatCheck(team, 4).ok && !seatCheck(team, 5).ok && /5 paid agent seats/.test(seatCheck(team, 5).reason) && has(team, 'sla') && !has(team, 'translation'));
check('each plan adds to the one below it', PLANS.suite.features.includes('translation') && PLANS.suite.features.includes('sla') && PLANS.pro.features.includes('sso') && PLANS.pro.features.includes('translation') && ['free', 'team', 'suite'].every((p, i, a) => i === 0 || PLANS[a[i - 1]].features.every(f => PLANS[p].features.includes(f))));
check('a card that failed (past due) keeps the plan for now; trialing counts', entitlements({ plan: 'suite', status: 'past_due', seats_paid: 3 }).plan === 'suite' && entitlements({ plan: 'suite', status: 'trialing', seats_paid: 3 }).plan === 'suite');
check('paused, canceled, unknown or zero seats fall back to free', ['paused', 'canceled', 'none', 'weird'].every(s => entitlements({ plan: 'pro', status: s, seats_paid: 9 }).plan === 'free') && entitlements({ plan: 'pro', status: 'active', seats_paid: 0 }).plan === 'free' && entitlements({ plan: 'free', status: 'active', seats_paid: 3 }).plan === 'free');
const lic = entitlements({ plan: 'free', status: 'none', seats_paid: 0, license: 'lifetime_unlimited' });
check('a lifetime licence is unlimited and has every feature, whatever the subscription says', lic.seats === Infinity && lic.license === 'lifetime_unlimited' && ALL_FEATURES.every(f => has(lic, f)) && seatCheck(lic, 100000).ok && seatCheck(lic, 5).limit === null && entitlements({ plan: 'team', status: 'canceled', seats_paid: 1, license: 'lifetime_unlimited' }).seats === Infinity);
check('prices are about a third of Zendesk (annual $6 / $18 / $39) and monthly costs more than annual', PLANS.team.price.year === 6 && PLANS.suite.price.year === 18 && PLANS.pro.price.year === 39 && ['team', 'suite', 'pro'].every(p => PLANS[p].price.month > PLANS[p].price.year) && priceOf('suite', 'year', 10) === 180 && priceOf('free', 'year', 3) === 0);
check('every plan feature is a known feature', Object.values(PLANS).every(p => p.features.every(f => ALL_FEATURES.includes(f))));
done();
