# Logging (Axiom, or any service that takes JSON)

Every function call writes one structured **request** line, and extra lines for errors, warnings, emails, AI calls, webhooks, billing events and audit entries. Lines always appear in the Netlify function log. With the settings below they are also sent to Axiom (free plan: 500 GB a month, 30 days kept).

## Set it up (5 minutes)
1. Create an account at axiom.co and a **dataset** called `effdesk`.
2. Settings → API tokens → new token, permission **Ingest** on the `effdesk` dataset only.
3. In Netlify → Site configuration → Environment variables add:
   - `AXIOM_TOKEN` = the token
   - `AXIOM_DATASET` = `effdesk`
   - `AXIOM_DOMAIN` = `api.eu.axiom.co` only if your Axiom account is in the EU region
4. Redeploy. Open Axiom → Stream and you should see lines within a minute.

Another service instead (Better Stack, Grafana, Datadog ...): set `LOG_DRAIN_URL` (and `LOG_DRAIN_TOKEN` if it wants a Bearer token). It receives the same JSON array by POST.

## What a line holds
`_time, level (info/warn/error), event, service, deploy, request_id, fn` and for `request` lines: `method, path, status, ms, org, user, role, action, ref, country`. The `request_id` is also returned to the browser as the `x-request-id` header and in the body of a 500, so a customer's screenshot leads straight to the log.

Events: `request`, `exception` (with a short stack), `console` (every `console.warn` and `console.error` in the code), `email` (ok, ms, recipient domain), `ai` (status, ms, model), `webhook` (status), `billing` (Paddle events), `audit` (the same entries as Manage → Audit log).

## What is never logged
Message text, subjects, email addresses, passwords, tokens, cookies, request bodies and query strings. Workspaces and people are ids. This is enforced in `src/log.js` (`scrub`) and covered by `scripts/test-log.js`.

## Useful queries (Axiom APL)
```
// errors in the last hour, newest first
['effdesk'] | where level == 'error' | sort by _time desc

// slowest actions on the desk (95th percentile, ms)
['effdesk'] | where event == 'request' and fn == 'tickets' | summarize p95=percentile(ms, 95), n=count() by action | sort by p95 desc

// failed sign-ins per hour
['effdesk'] | where event == 'request' and path startswith '/api/auth/sign-in' and status >= 400 | summarize count() by bin(_time, 1h)

// one customer's trouble report
['effdesk'] | where request_id == 'PASTE-THE-ID'

// AI use and failures
['effdesk'] | where event == 'ai' | summarize count(), avg(ms) by status
```
Add a **monitor** in Axiom for `level == 'error'` (alert to email or Slack) and one for `status >= 500` count over 5 minutes.

## Notes
- Sending happens after the answer leaves (`context.waitUntil`) and can never fail or slow a request; a down log service changes nothing for visitors.
- Logging in the browser (front-end errors) is not included yet: it needs a small public endpoint with rate limits.

## Errors, status page and the owner console (added)
- **Errors**: every crash, 5xx, `console.error` and browser script error becomes one row per kind (fingerprint) with a count, listed at `/admin.html#errors`. New kinds, kinds that come back after being resolved, and kinds still happening an hour later are emailed to `PLATFORM_ADMIN_EMAILS`. Rows hold no customer content. Search the logs for the request id shown on each row.
- **Axiom**: set `AXIOM_TOKEN` and `AXIOM_DATASET=effdesk` in Netlify (and `AXIOM_DOMAIN` only for the EU region), redeploy, then use *Logging → Send a test log line* in the console. It shows what Axiom answered.
- **Status page**: public at `/status` (JSON `/api/status`, feed `/status/feed.xml`). Manage components, incidents and maintenance at `/admin.html#status`. The page shows the worst of a component's own status, open incidents, maintenance in progress and a live database check, so it is only as accurate as what you post.
- **Owner console**: customers (plan limits, feature switches, suspend with a reason), people (sign out, verify), announcement banner, pause sign-ups, activity log.
