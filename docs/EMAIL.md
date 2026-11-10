# Email in and out

EffDesk sends and receives ticket email through Resend, on a **separate subdomain** (`in.effdesk.com`) so ticket mail never mixes with the product's own mail (sign-in links) on `effdesk.com`.

## What customers (organizations) can choose
Under **Email settings** in the desk, an owner or admin sets:
- **Support address**: `<name>@in.effdesk.com`. Customers write to it; an organization can also forward its own mailbox (for example support@theirdomain.com) to it.
- **Replies**: one of three
  - *Come back into the ticket* (default): each emailed reply carries a private Reply-To address for that ticket, so the customer's answer lands in the same ticket.
  - *Go to my own address*: Reply-To is an address the organization chooses (its own mailbox).
  - *No-reply*: sent from `no-reply@in.effdesk.com` with no Reply-To; the email says this address does not receive replies.
- **Sender name** and a **signature**.

## One-time setup for you (the platform owner)
1. In Resend, add the domain `in.effdesk.com`. Verify it for **sending** (SPF and DKIM records) and turn on **receiving** (Resend shows the MX record to add). Add every record in Cloudflare as **DNS only** (grey cloud). Follow Resend's own "Receiving emails" guide for the exact values: they are the source of truth.
2. In Resend, create a **webhook** with the URL `https://app.effdesk.com/api/webhooks/email` for the event **email.received**. Copy its signing secret (starts with `whsec_`).
3. In Netlify, add these environment variables, then redeploy:
   - `INBOUND_DOMAIN=in.effdesk.com`
   - `RESEND_WEBHOOK_SECRET=` the `whsec_...` value from step 2
   - `RESEND_API_KEY` must be a key with full access (it also reads the received message). If you created a sending-only key, make a new one.
4. Test: set a support address in the desk, email it from your own mailbox, and the ticket appears. Reply from the desk and the email arrives with a private Reply-To.

## How threading works
- Replies to the private address are recognised by a signed code in it (a wrong code never reaches a ticket; the message becomes a new ticket).
- Replies to the plain address are recognised by the `In-Reply-To` Message-ID, and only when they come from the person who opened the ticket.
- Quoted history ("On ... wrote:") is cut from incoming replies.
- A reply on a solved or pending ticket reopens it. A reply on a **closed** ticket opens a follow-up ticket.

## Protection
- The webhook signature (Svix) is verified on the exact bytes; events are de-duplicated; Message-IDs are stored once.
- Dropped silently: automatic mail (auto-replies, bulk, mailing lists, bounces, no-reply senders), mail from our own domain (loops), mail that fails DMARC, mail to unknown addresses.
- A flood guard stops an organization receiving more than 200 new email tickets an hour.
- Outgoing limit per organization per 24 hours: Free 50, Team 500, Suite 2,000, Pro 5,000.
- If the mail provider fails, the agent's reply is still saved and the desk says the email was not sent.

## Attachments
- Files live in Netlify Blobs (nothing to set up: Netlify provides it). The table `attachments` is the index.
- Agents attach up to 5 files of 5 MB each to a reply; they are emailed as real attachments.
- Incoming files are kept up to 10 MB each and 25 MB per email; anything skipped is listed on the ticket ("Not stored: ...").
- Storage per organization: Free 500 MB, Team 5 GB, Suite 20 GB, Pro 100 GB.
- Downloads need a signed-in member of the organization, are always sent as an attachment (never shown inside our pages) and are sandboxed.
- Needs `RESEND_API_KEY` with full access, because the key also lists and downloads the received files.

## Not yet built
- **An organization's own sending domain** (mail from support@theirdomain.com itself, with their SPF and DKIM). This is a natural Pro feature using Resend's domains API.
- Changing a support address later breaks private reply addresses in emails already sent.
