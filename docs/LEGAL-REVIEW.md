# What a lawyer must decide before launch

The documents in `public/legal` are **drafts written as a starting point, not legal advice**. Each carries a draft banner (`data-draft="1"`); a test checks that. Remove the banner from a page only after a qualified lawyer approves it.

## Decisions and blanks to fill
- **Legal entity**: who is "EffDesk" (an LLC?), its address and contact emails. Used in the terms, privacy policy and DPA. Form the entity before you sign Paddle's terms.
- **Governing law, venue, disputes, limitation of liability, indemnities, warranty disclaimer** (terms sections 10 and 12).
- **Privacy**: region where the database lives; retention periods (account data, security logs, backups); whether you need an EU/UK representative; cookie wording if you ever add analytics.
- **DPA**: GDPR and UK GDPR annexes to the Standard Contractual Clauses, audit rights, the CCPA/CPRA service-provider wording.
- **Subprocessors**: keep the list true. Add the AI provider when AI features run on the server. Give customers 30 days' notice of changes (the DPA promises it).
- **Refunds**: align with Paddle's buyer terms (Paddle is merchant of record).
- **Free plan**: inactivity closure (12 months) and the abuse rules.
- **HIPAA / PCI / children**: the AUP forbids card numbers; decide whether you will ever sign a BAA (this design does not support one yet).

## Things the product already does that the documents rely on
- Passwords are hashed (Better Auth, scrypt); two-factor is available; sign-in is rate limited.
- Tenant data is separated by organization id and by Postgres row-level security.
- Customer data is not used for advertising or to train models.
- Administrative changes (plan, licence) are written to an audit log.

## Things the documents promise that are **not built yet** (see PLAN.md)
- Customer data export and account deletion tools (promised in terms section 7 and the DPA).
- 30-day-deletion job after account closure.
- Breach-notification runbook.
