# The desk: features, plans and themes

The agent desk (`/desk.html`) is laid out like a help-desk console: icon rail, ticket tabs beside a Views tab, and a ticket in three columns. Code: `public/js/desk.js`, `public/css/desk.css`; server: `src/desk.js`, `src/tickets.js`, `src/handlers.js` (actions on `/api/tickets`); tables: `migrations/009_desk.sql`, `010_prefs.sql`.

## What is on which plan
The plan of each feature is set in one place, `src/plans.js` (`BASE`, `TEAM`, `SUITE`, `PRO`); the server refuses a feature the plan lacks with a 402 that names the plan, and the desk shows "Part of the Team plan" in place of the control.

| Feature | Free | Team | Suite | Pro |
|---|---|---|---|---|
| Ticket type, labels with suggestions, CC, follow, merge, timeline, edit your own message, macros, send as open/pending/solved | yes | yes | yes | yes |
| Themes: Classic and Midnight | yes | yes | yes | yes |
| Themes: Aurora, Sunset, Forest, Ocean, Orchid | | yes | yes | yes |
| Queues, clients with notes, linked problem/incident tickets, saved views | | yes | yes | yes |
| Side conversations (email an outside person; the reply comes back to the ticket) | | | yes | yes |

## Notes
- **Merge** moves messages, files, side conversations and followers to the target, unions labels and CC, and closes the source with a pointer. It cannot be undone.
- **CC** people get a copy of every public reply, and can answer through the ticket's private reply address.
- **Clients**: a client with a domain picks up new tickets from that domain by itself. Notes are for the team only.
- **Side conversations** use a private reply address per conversation (`inbox+s<id>.<code>@in...`). Only the person written to can answer; their reply lands in the conversation, never in the customer's thread. Each mail counts toward the plan's daily email limit.
- **Macros** fill the reply (`{{name}}` = requester's first name, `{{agent}}` = you) and can set status, priority and labels when sent. Only owners and admins create them.
- **Themes** are saved per person (`desk_prefs`) and cached in the browser so the page does not flash. A premium theme saved before a plan ended falls back to Classic. The three lists (server `src/themes.js`, picker colours in `desk.js`, styles in `desk.css`) are kept in step by a test.
- Not built yet: emailing followers when the customer replies, and translating messages.

## Dashboard (home)
The desk opens on a dashboard (action `dashboard`, `src/dashboard.js`): open / pending / unassigned / mine / new and solved today, SLA breached (plans with SLA), your tickets, tickets that need an owner, and a setup checklist (support email, first article, a teammate, a first ticket). The numbers link to the matching ticket list. The top-left logo and the Home tab go to this page, not the marketing site.

## Profile pictures, @mentions, webhooks
* **Pictures:** each agent can upload one (profile page). It is cut to a 128-pixel square on the device, checked by its first bytes on the server (PNG/JPEG/WebP, under 60 KB) and shown on the profile button and next to messages.
* **@mentions:** in an internal note, `@ann` (the part of the email before the @) emails that teammate. A list in the note box inserts the handle. Only current members; never yourself.
* **Webhooks (Team plan, admins):** Manage > Integrations. Events: ticket.created, ticket.updated, message.agent, message.customer, ticket.mentioned. Each POST is signed: `X-EffDesk-Signature: sha256=` + HMAC-SHA256(secret, timestamp + "." + body). Public https addresses only, 5 second limit, no redirects, up to 10 per organization.

## Team (owners and admins) and the platform customer list
* **Manage > Team:** people with role, open tickets and last active; change a role (an owner is needed to make or change an owner; there is always at least one owner; you cannot change or remove yourself here); remove someone and hand their open tickets to a teammate; pending invitations with resend and cancel; invite by email as agent or admin; seats used against the plan with an "Add seats" link. Role changes, removals and invitations go in the audit log.
* **Platform admin (`/admin.html`, platform owner only):** a customer directory with plan and billing state, seats, agents, tickets in the last 30 days and in total, last activity and a health label (healthy, free, heavy use, stalled, past due, canceled), with filters, search and a CSV download. Counts only: never ticket text or customer addresses. Fixed in the same change: the licence buttons called `/api/license` while the function lived at `/api/admin/license`; the function now answers on both.
* Not built: suspending an organization (needs a check in every endpoint) and a daily usage summary table (the counts are computed live, fine into the hundreds of customers).

## Light agents, bulk actions, round-robin
* **Light agents** (Team plan and up): a role in Manage > Team. They are free (not counted as a seat), can read tickets and add internal notes, and cannot reply, change, assign or see settings. They are never picked by round-robin.
* **Bulk actions** (Team and up): tick tickets in the Views list, then set status, priority or assignee for all of them (up to 100 at a time). Solving in bulk also asks customers for a rating.
* **Round-robin:** an automation action "Assign to > Next available agent" hands a ticket to the full agent with the fewest open tickets.

## Our own workspace (mdv) with the lifetime licence
Set the Netlify variable `OWNER_WORKSPACES=mdv:you@yourcompany.com` (several allowed, comma separated, as `address:email`). Then:
1. Nobody else can register `mdv` (it shows as reserved to everyone else).
2. Sign up at effdesk.com with that exact email and workspace address `mdv`, confirm the email, and the workspace is created with the **lifetime licence** at once: every feature, no seat limit, not changed by Paddle events.
3. If the workspace already exists, grant the licence on `/admin.html` (needs `PLATFORM_ADMIN_EMAILS=you@yourcompany.com`).

## Business hours and SLA alert emails
* **Business hours** (Manage > SLA): working windows per weekday in a time zone. When on, SLA clocks count only those minutes (a 1-hour target started Friday 16:30 falls due Monday 09:30). The "at risk" point (80%) uses the same calendar. Off by default (around the clock).
* **Alerts:** every hour (the `automations` function) each active ticket that reaches "at risk" or "breached" emails its owner once per state, or the owners and admins when nobody has it. People with notifications off are skipped.
* With business hours on, the SLA filters in Views and the dashboard count are computed from the 2000 most recently updated active tickets.
