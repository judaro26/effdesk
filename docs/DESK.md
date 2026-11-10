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
