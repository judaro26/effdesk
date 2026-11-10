# Setting up Sundesk (what only you can do)

## 1. Neon (the database)
1. Create a **new Neon project** named `sundesk` (not the one used by anything else), in an AWS region near your customers.
2. Copy the **pooled** connection string (the host contains `-pooler`) into Netlify as `DATABASE_URL`.
3. Migrations run by themselves: Netlify's build command (`scripts/migrate-on-build.js`) applies new files in `migrations/` on every **production** deploy (previews skip it). To run them by hand: `DATABASE_URL=... npm run migrate`.
4. Check the role the app connects with is **not** a superuser (Neon's default owner role is not). Row-level security does not apply to superusers.
5. Turn on point-in-time restore for the project (Neon settings) and note the retention you chose in the privacy policy.

## 2. Netlify
1. New site from the `sundesk` repository; build command empty, publish directory `public`, functions `netlify/functions` (already in `netlify.toml`).
2. Environment variables: everything in `.env.example`. Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`.
3. Domain: pick one for the product (for example `sundesk.com` for the site and `app.` for the app) and set `APP_URL` to it with `https://`.

## 3. Resend (the product's own email)
Create an account, verify your sending domain (SPF and DKIM records), create an API key as `RESEND_API_KEY`, and set `MAIL_FROM`.

## 4. Paddle (payments)
1. Create a Paddle account and complete its website review: it checks that the site shows pricing, terms, privacy and refund pages (they exist in `public/legal`, drafts until approved).
2. Create three **products** (Team, Suite, Pro), each with a **monthly** and a **yearly** price, priced **per unit (per seat)** in USD: Team $8 / $72 (= $6 a month), Suite $23 / $216, Pro $49 / $468. Quantity is the number of agents.
3. Copy each price id into the `PADDLE_PRICE_*` variables. Copy the client-side token into `PADDLE_CLIENT_TOKEN`.
4. Add a notification destination `https://<your site>/api/webhooks/paddle` for the `subscription.*` events and copy its secret into `PADDLE_WEBHOOK_SECRET`.
5. Start with `PADDLE_ENV=sandbox`; change it to `production` when you go live.

## 5. The platform owner and mdv's licence
1. Put your email in `PLATFORM_ADMIN_EMAILS`. Sign up with it and confirm the address.
2. Sign up as mdv's owner and create the organization (for example slug `mdv`).
3. While signed in as the platform owner, grant the licence:
   `POST /api/admin/license  {"slug":"mdv","note":"Lifetime unlimited licence"}`
   (revoke with `DELETE` and the same body). It is audited and Paddle can never change it.
