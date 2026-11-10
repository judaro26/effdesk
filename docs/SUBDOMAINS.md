# Per-customer addresses (rooster.effdesk.com): options and recommendation

Status: **research only, nothing built.** Written after reading how mdv does it (`.github/workflows/client-golive.yml`, `scripts/client-golive.js`, `scripts/lib/netlify-domains.js`, `docs/MULTI-WORKSPACE.md`, "The address made for the client").

## How mdv does it (per-client alias)
An approved request makes `<id>.mdv-ai.com`: (1) add it to the Netlify site's domain aliases (read the list, write it back with one change, because Netlify replaces the whole list), (2) create a DNS-only CNAME in Cloudflare, (3) ask Netlify for a certificate, (4) a GitHub Action every 30 minutes checks DNS + TLS and takes the client live. The address is computed from the name, never typed, so a request cannot name someone else's domain. Limits mdv's own docs note: Netlify allows 100 domains per site, each needs its own certificate (minutes), and wildcard on Netlify needs Netlify DNS and cannot sit on a site that also has aliases. A human approves each request (a label on an issue).

## What EffDesk already has
The public help center and portal live at `/help/<slug>/...` and the slug is already unique, validated and held at signup (`onboarding.js`). So a subdomain only has to map the Host header to a slug. The agent desk, sign-in and billing stay on the app host (session cookies are host-only, which also keeps each portal isolated).

## Options
| | How | Per-customer work | Time to live | Ceiling | Notes |
|---|---|---|---|---|---|
| A. mdv copy | Netlify alias + Cloudflare CNAME + cert, run by a GitHub Action | API calls, retries, cert wait | minutes | ~100 domains | Proven pattern, but a queue, polling and a limit we do not need. |
| B. Netlify wildcard | `*.help.effdesk.com`, delegate that sub-zone to Netlify DNS | none | instant | unlimited | Needs Pro-level wildcard support and moving that sub-zone to Netlify DNS; cannot coexist with aliases on the same site. |
| **C. Cloudflare wildcard + Worker (recommended)** | Proxied `*.effdesk.com`, free wildcard certificate, one Worker route `*.effdesk.com/*` that maps `<slug>.effdesk.com/x` to the Netlify site's `/help/<slug>/x` | **none**, creating the org creates the address | instant | unlimited | Same idea as mdv's support email worker. The apex, `app.` and `in.` stay as they are (explicit records win over the wildcard). |
| D. Customer's own domain (help.rooster.com) | Cloudflare for SaaS custom hostnames, or mdv's alias flow | customer adds one CNAME | minutes | large | Later, as a paid add-on (Suite/Pro). |

## Recommendation
Build **C**, and nothing needs engineering approval because nothing is provisioned per customer:
1. Cloudflare: proxied wildcard record `*` for effdesk.com (DNS only for `app`, `in`, apex stay as they are).
2. Worker (in the repo, deployed by a GitHub Action with `wrangler`, like mdv's): read the first label of the Host header, check it against the reserved list, rewrite to `https://<site>.netlify.app/help/<label>/<rest>` and pass cookies and POSTs through, re-write links in the HTML or serve pages with relative links (the help pages already take a `base`).
3. App: `help.mjs` accepts the slug from a trusted header the Worker sets (`x-effdesk-org`, with a shared secret so nobody can spoof it), and builds `base` as `` (empty) on a subdomain and `/help/<slug>` otherwise. Portal sign-in links in email use the subdomain.
4. Reserved slugs: `www app in api mail help status docs admin support billing` and so on, refused at signup (check the list in `onboarding.js`).
5. Show the address in Email settings and on the dashboard setup checklist.

Open points to decide: (a) is effdesk.com's DNS fully on Cloudflare (it is today) and may the main site stay DNS-only while the wildcard is proxied; (b) Cloudflare Workers plan (free tier covers 100k requests/day, a paid plan is $5/month); (c) whether the custom-domain add-on (D) should come with the Suite plan. Not verified against live accounts: Netlify and Cloudflare limits above are from mdv's docs and general knowledge, so confirm before relying on them.

## Built (recommendation C)
* `cloudflare/portal-worker.js` + `wrangler.toml`: `<slug>.effdesk.com/x` is served from `/help/<slug>/x`; links, forms, redirects and cookie paths are rewritten back. Reserved names (`app`, `in`, `www`, …) pass through.
* `.github/workflows/deploy-portal-worker.yml`: publishes the Worker when `cloudflare/**` changes on main. Nothing per customer.
* App: `portalOrigin()` in `src/handlers.js` trusts the public address only when `x-effdesk-secret` equals `PORTAL_PROXY_SECRET`; sign-in links in portal emails use that address. The dashboard shows each org its address when `PORTAL_DOMAIN` is set.
* Tests: `scripts/test-portal-worker.js`.

### One-time setup (you, about 10 minutes)
1. Cloudflare DNS for effdesk.com: add a **proxied** (orange cloud) `A` record named `*` pointing to `192.0.2.1` (a placeholder; the Worker answers before it is used). Keep `app`, `in` and the apex as they are.
2. GitHub repo secrets: `CLOUDFLARE_API_TOKEN` (Workers Scripts: Edit, Zone Workers Routes: Edit), `CLOUDFLARE_ACCOUNT_ID`, `PORTAL_PROXY_SECRET` (long random). Repo variable `ORIGIN_HOST` = the Netlify site host (e.g. `effdesk.netlify.app`).
3. Netlify env: `PORTAL_PROXY_SECRET` (same value), `PORTAL_DOMAIN=effdesk.com`. Redeploy.
4. Run the "Deploy portal worker" workflow once. Then open `https://<your-org-slug>.effdesk.com`.
Not verified live: the Worker, the wildcard certificate and the Netlify host behaviour have only been tested with fakes.
