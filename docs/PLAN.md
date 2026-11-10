# EffDesk build plan

The portal screens of mdv's support desk (tickets, help center, SLA, translation, roles) already exist as plain browser scripts that talk to one `api(action, payload)` door. EffDesk keeps that contract and reimplements the server side on Postgres, so the screens can be copied over with little change. The main work is the data layer, because mdv's version stores documents in Firestore.

## Phase 0: foundation (done in this repository)
Own repo, own Neon database, own sign-in (Better Auth), organizations and invitations, seat limits, plans and prices, Paddle webhooks and checkout details, lifetime licence for mdv, row-level security, landing and pricing, account page, draft legal documents. Tests on a real Postgres.

## Phase 1: tickets core
Postgres schema for tickets, messages, attachments (object storage), queues, labels, macros, views; a repository layer with every query scoped by `org_id`; the agent portal screens; plan gating (`has(entitlements, 'sla')` and so on). Exit: an agent in a free organization can create and answer tickets in the browser.

## Phase 2: email in and out
A per-organization reply address and inbound email webhook (Resend inbound or Postmark), outbound ticket notifications from the organization's own name, bounce and abuse handling, rate limits per plan. Exit: a customer writes to support@theirdomain and the agent answers from EffDesk.

## Phase 3: help center and customer portal
Bilingual articles, search, related articles, per-organization branding and custom domain, customer sign-in (magic link), "my tickets".

## Phase 4: service levels, translation, AI, reports
SLA policies and alerts, the on-device translation helper, optional AI helpers with per-organization budgets, reports and leaderboard, satisfaction surveys.

## Phase 5: admin and security
Roles with permissions, audit viewer, data export and account deletion (the terms promise these), two-factor enforcement, SSO (Better Auth SSO plugin) on Pro, API tokens and webhooks.

## Phase 6: move mdv over
Export mdv's Firestore support collections, load them into Postgres under the mdv organization, run both for a short overlap, switch the mail address, then retire the embedded portal in the mdv repository. mdv keeps a lifetime unlimited licence.

## Phase 7: launch
Lawyer-approved documents, Paddle live, status page, backup and restore drill, breach runbook, support mailbox, first outside customers.

## Open decisions
- Free seats on paid plans: today paid seats are priced for **every** agent and the 2 free seats do not stack on top. The alternative ("2 free plus paid extras") is friendlier but gives away more.
- Light agents (read and note only) are not built; every member uses a seat.
- Data region: one region at first; EU hosting later if customers ask.
