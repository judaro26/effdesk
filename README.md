# EffDesk

A simple, affordable help desk: email tickets, a bilingual help center, service levels and message translation.
Two agents are free forever; paid plans are priced per agent at about a third of the usual market price.

Its own product: its own repository, its own Netlify site, its own Neon database, its own sign-in, its own legal documents. The first customer is mdv, on a lifetime unlimited licence.

## What is here (phase 0, the foundation)

| Area | Where | What it does |
|---|---|---|
| Plans and seats | `src/plans.js` | Free (2 agents), Team, Suite, Pro; features per plan; lifetime licence |
| Sign-in | `src/auth.js` | Better Auth, self-hosted: email + password (confirmed address), reset, two-factor, organizations, invitations, rate limits |
| Seat limit | `src/auth.js` hooks, `src/billing.js` | Inviting or adding an agent beyond the plan is refused (a pending invitation holds a seat) |
| Billing | `src/billing.js`, `src/handlers.js` | Paddle (merchant of record): signed webhooks, de-duplicated, ordered; checkout details |
| Licences | `src/license.js` | The platform owner grants or revokes a lifetime unlimited licence (mdv) |
| Tenant isolation | `migrations/002_core.sql`, `src/db.js` | Every tenant table carries `org_id` and Postgres row-level security |
| Public site | `public/` | Landing and pricing, sign-in pages, account page, invitations, draft legal documents |
| API | `netlify/functions/*.mjs` | Thin wiring of `src/handlers.js` to addresses |

Next phases are in [docs/PLAN.md](docs/PLAN.md). Setting up the accounts (Neon, Netlify, Paddle, Resend) is in [docs/SETUP.md](docs/SETUP.md). What a lawyer must still decide is in [docs/LEGAL-REVIEW.md](docs/LEGAL-REVIEW.md).

## Run the tests

```
npm install
npm test
```

The tests start a throwaway local PostgreSQL (or use `TEST_DATABASE_URL`), apply the migrations, and exercise real sign-ups, invitations, webhooks and row-level security.

## Changing the sign-in configuration

`migrations/001_auth.sql` is generated from `src/auth.js`. After adding or changing a Better Auth plugin, run `npm run auth:sql` and commit the file; a test fails when they disagree.

## Renaming the product

The name lives in `src/config.js`, the pages in `public/` and the legal documents. A search for "EffDesk" finds them all.
