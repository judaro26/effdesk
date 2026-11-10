# EffDesk REST API (Suite plan)

Make a token under **Manage > API** (owners and admins). It looks like `effk.<organization id>.<secret>` and is shown once. Send it on every request:

    Authorization: Bearer effk.…

Base address: `https://app.effdesk.com/api/v1`. Bodies are JSON. Things the API does show as **API: <token name>** in the ticket history. Creating tickets, replying, and updating start the same webhooks and automations as the desk.

| Method and path | What it does |
|---|---|
| `GET /tickets?status=open&q=text&tag=vip&limit=50&offset=0` | list tickets (newest first) with status counts |
| `POST /tickets` `{ subject, body, requesterEmail, requesterName?, priority? }` | create a ticket (channel `api`) |
| `GET /tickets/{number}` | one ticket and its public messages |
| `PATCH /tickets/{number}` `{ status?, priority?, type?, tags?, assigneeId?, queueId?, cc? }` | update a ticket |
| `POST /tickets/{number}/comments` `{ body, public?: true, status? }` | add a public reply (emailed to the customer) or, with `"public": false`, a private note |

Errors are `{ "error": "…" }` with 400 (bad input), 401 (no or wrong token), 402 (plan), 404, 405, 413. Revoke a token in the same screen and it stops working immediately.

## Webhooks (Manage > Integrations)
Events: `ticket.created`, `ticket.updated`, `message.agent`, `message.customer`, `ticket.mentioned`.
* **Signed JSON:** header `X-EffDesk-Signature: sha256=<hex>` is HMAC-SHA256 of `<X-EffDesk-Timestamp>.<raw body>` with the secret shown once when the webhook was added. Reject messages whose timestamp is more than a few minutes old.
* **Slack:** paste a channel's incoming webhook address (`https://hooks.slack.com/services/…`). **Microsoft Teams:** paste the Workflows or connector webhook address; EffDesk posts an Adaptive Card.
