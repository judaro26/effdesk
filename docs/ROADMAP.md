# Roadmap against Zendesk / Freshdesk / Help Scout

Built: tickets, email in and out, labels, queues, clients, CC, merge, side conversations, linked tickets, macros, saved views, SLA timers, reports, translation, help center and customer portal, follower and mention emails, themes, profile pictures, webhooks, per-customer addresses (see SUBDOMAINS.md), dashboard.

Next, in the order that sells best:
1. **Triggers and automations** (if/then rules: auto-assign, auto-tag, auto-reply, close after N days; plan list already reserves `triggers`).
2. **Customer satisfaction (CSAT)** survey after solve (reserved `csat`) feeding the reports.
3. **API tokens and a public REST API** (the webhooks' counterpart), plus ready-made Slack and Zapier recipes.
4. **Slack and Microsoft Teams notifications** (an incoming-webhook URL per organization, using the same event stream).
5. **Custom ticket fields and forms** on the portal (`custom_fields`), ticket types and priorities per form.
6. **Light agents (free, comment only) and custom roles** (`custom_roles`), audit log, SSO (SAML) and 2FA enforcement for Pro.
7. **Live chat widget** and an embeddable help-center search widget.
8. **Knowledge-base extras:** article feedback is built; add categories, drafts review, and AI-suggested answers (`ai_assist`).
9. **Business hours and holidays** for SLA (today it is around the clock), and breach alert emails.
10. **Round-robin / load-based assignment**, ticket collision warnings ("Ann is replying"), bulk actions, keyboard shortcuts.
11. **Channels:** SMS/WhatsApp, Facebook/Instagram, voice (partners).
12. **Customer's own domain** for the portal (help.rooster.com).
