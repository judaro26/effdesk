# WhatsApp

EffDesk uses Meta's WhatsApp Business Cloud API. Each workspace connects its own number (Manage > Channels > WhatsApp, Suite plan and up).

## Setup (customer side)
1. In Meta for Developers create an app with the WhatsApp product and add a business phone number.
2. Copy the **phone number ID**, a **permanent access token** (system user token) and the **app secret** (Settings > Basic).
3. Paste them into Manage > WhatsApp and save. The token and secret are stored encrypted and never shown again.
4. In Meta, WhatsApp > Configuration > Webhook: paste the **webhook address** and **verify token** shown in the desk, then subscribe to `messages`.

## How it behaves
- Webhook: `POST/GET /api/webhooks/whatsapp` (`netlify/functions/whatsapp-webhook.mjs`). Every POST is checked against `X-Hub-Signature-256` with the workspace's app secret; repeats (same message id) are ignored.
- A message from a number with an open WhatsApp ticket joins it; otherwise it opens a new ticket (channel `whatsapp`, requester name from the WhatsApp profile, placeholder email `<number>@whatsapp.invalid` that the mailer never sends to). Closed tickets are not reopened; a new one starts.
- Agent replies are sent as free text. Meta only accepts these within **24 hours of the customer's last message**: later replies are refused before anything is saved, with the text kept in the box. Template messages are not built yet.
- Delivery reports (sent, delivered, read, failed with Meta's reason) are shown next to each agent message. A late report never moves a message backwards.
- Photos, voice notes and documents arrive as a line saying so; the files are not copied into the desk yet (to do: download the media with the access token and store it as attachments).

## Not verified against live Meta
Tests use a fake Meta (`scripts/test-whatsapp.js`). Try it first with Meta's free test number before selling it.
