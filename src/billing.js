// src/billing.js: WHAT AN ORGANIZATION MAY DO (plan, seats, licence) AND HOW PADDLE'S EVENTS CHANGE IT.
// Paddle (merchant of record) takes the payment and handles sales tax; we only keep the plan, the number of seats paid for and the status.
import crypto from 'crypto';
import { entitlements, applyOverrides, seatCheck, SEAT_ROLES, PAID_PLANS, INTERVALS } from './plans.js';

export async function getSubscription(db, orgId) {
  return (await db.query('select * from subscriptions where org_id = $1', [orgId])).rows[0] || null;
}
// the plan and the owner's per-customer settings in ONE round trip
export async function getEntitlements(db, orgId) {
  const row = (await db.query('select s.*, ov.seat_limit, ov.mail_per_day, ov.storage_mb, ov.ai_monthly, ov.features_on, ov.features_off, ov.suspended, ov.suspended_reason from (select $1::text as oid) x left join subscriptions s on s.org_id = x.oid left join org_overrides ov on ov.org_id = x.oid', [orgId])).rows[0];
  return applyOverrides(entitlements(row && row.org_id ? row : null), row && (row.seat_limit != null || row.mail_per_day != null || row.storage_mb != null || row.ai_monthly != null || row.suspended || (row.features_on && row.features_on.length) || (row.features_off && row.features_off.length)) ? row : null);
}
// seats in use: members plus invitations still waiting (a seat is reserved when someone is invited)
export async function seatsUsed(db, orgId) {
  const r = await db.query(`select (select count(*) from member where "organizationId" = $1 and role = any($2))::int
    + (select count(*) from invitation where "organizationId" = $1 and status = 'pending' and "expiresAt" > now() and role = any($2))::int as used`, [orgId, SEAT_ROLES]);
  return r.rows[0].used;
}
export async function checkSeat(db, orgId) { return seatCheck(await getEntitlements(db, orgId), await seatsUsed(db, orgId)); }

// ── Paddle ──
// the plan and interval that each Paddle price id means: PADDLE_PRICE_TEAM_MONTH=pri_..., PADDLE_PRICE_TEAM_YEAR=..., and so on for suite and pro
export function priceMap(env = process.env) {
  const m = {};
  for (const plan of PAID_PLANS) for (const interval of INTERVALS) { const id = env[`PADDLE_PRICE_${plan.toUpperCase()}_${interval.toUpperCase()}`]; if (id) m[id] = { plan, interval }; }
  return m;
}
export const priceIdFor = (plan, interval, env = process.env) => env[`PADDLE_PRICE_${String(plan).toUpperCase()}_${String(interval).toUpperCase()}`] || '';

// "Paddle-Signature: ts=1671552777;h1=<hex>", h1 = HMAC-SHA256 of "<ts>:<raw body>" with the endpoint secret; refuse anything older than 5 minutes
export function verifySignature(rawBody, header, secret, nowMs = Date.now(), toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(';').map(p => p.trim().split('=')).filter(p => p.length === 2));
  const ts = Number(parts.ts); if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSec || !parts.h1) return false;
  const want = crypto.createHmac('sha256', secret).update(`${parts.ts}:${rawBody}`).digest('hex');
  const a = Buffer.from(want), b = Buffer.from(String(parts.h1));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const STATUS_OK = ['active', 'trialing', 'past_due', 'paused', 'canceled'];
// One verified event. Returns what happened (for the log and the tests). Safe to call twice with the same event, and an old event never overwrites a newer one.
export async function applyPaddleEvent(db, event, env = process.env) {
  const id = String(event && event.event_id || ''), type = String(event && event.event_type || '');
  if (!id || !type) return { ok: false, why: 'malformed' };
  const fresh = await db.query('insert into webhook_events (id, provider, type) values ($1, $2, $3) on conflict (id) do nothing returning id', [id, 'paddle', type]);
  if (!fresh.rowCount) return { ok: true, why: 'duplicate' };
  if (!type.startsWith('subscription.')) return { ok: true, why: 'ignored' };
  const d = event.data || {}, orgId = d.custom_data && d.custom_data.org_id ? String(d.custom_data.org_id) : '';
  if (!orgId) return { ok: false, why: 'no-org' };
  const known = priceMap(env), items = (d.items || []).map(i => ({ ...(known[i.price && i.price.id] || {}), qty: Number(i.quantity) || 0 })).filter(i => i.plan);
  if (!items.length) return { ok: false, why: 'unknown-price' };
  const plan = items[0].plan, interval = items[0].interval, seats = items.reduce((n, i) => n + i.qty, 0);
  const status = STATUS_OK.includes(d.status) ? d.status : 'none', at = event.occurred_at ? new Date(event.occurred_at) : new Date();
  const org = await db.query('select 1 from "organization" where id = $1', [orgId]); if (!org.rowCount) return { ok: false, why: 'unknown-org' };
  const r = await db.query(`insert into subscriptions (org_id, plan, interval, seats_paid, status, paddle_customer_id, paddle_subscription_id, current_period_end, paddle_event_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    on conflict (org_id) do update set plan = $2, interval = $3, seats_paid = $4, status = $5, paddle_customer_id = $6, paddle_subscription_id = $7, current_period_end = $8, paddle_event_at = $9, updated_at = now()
    where subscriptions.paddle_event_at is null or subscriptions.paddle_event_at <= $9`,
  [orgId, plan, interval, seats, status, d.customer_id || null, d.id || null, d.current_billing_period && d.current_billing_period.ends_at ? new Date(d.current_billing_period.ends_at) : null, at]);
  return { ok: true, why: r.rowCount ? 'applied' : 'stale', orgId, plan, seats, status };
}
// what the checkout overlay needs: which price, how many seats, and our organization id so the event comes back with it
export function checkoutConfig({ orgId, plan, interval, seats }, env = process.env) {
  if (!PAID_PLANS.includes(plan) || !INTERVALS.includes(interval)) return { error: 'Choose a plan and a billing interval.' };
  const n = Math.floor(Number(seats)); if (!(n >= 1 && n <= 500)) return { error: 'Choose between 1 and 500 agents.' };
  const priceId = priceIdFor(plan, interval, env); if (!priceId) return { error: 'That plan is not available yet.' };
  return { priceId, quantity: n, customData: { org_id: orgId } };
}
