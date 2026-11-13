# English and Spanish localization

EffDesk's interface localization is shared through `public/js/i18n.js`. The language preference is stored in the browser for public/requester surfaces and in the authenticated agent's workspace preferences for the agent desk. User-authored ticket messages, internal notes, rich HTML replies, knowledge article bodies and code samples are intentionally not machine-translated by the interface layer.

## Coverage in this release

The language switcher is loaded on the core product and public application pages:

- Agent desk (the agent's selected language is also saved with their per-workspace preferences).
- Account and billing, authentication, platform administration, integrations, chat and welcome flows.
- Marketing homepage, developer guide and invitation acceptance.
- Problem Management and Incident Management controls, labels, forms, status names, empty states and validation messages.

The dictionary is additive. New interface text should be added in English and Spanish together, and dynamic UI should use `EffI18n.t(text, locale)` or create text nodes that the shared observer can translate. Do not translate user-generated or rich-content regions.

## Remaining parity work

This release does not claim complete Spanish parity yet:

- Legal documents under `public/legal/` remain English-only drafts until a qualified legal reviewer approves Spanish equivalents. They should not be machine-translated and presented as binding legal terms.
- Some less frequently used admin, integration, billing and developer-guide copy still needs a full screen-by-screen review.
- Emails, notification templates, third-party OAuth consent screens, provider-generated errors and customer-authored knowledge content require separate locale-aware handling.
- Translation quality, regional terminology and accessibility labels need a native Spanish QA pass.

## Definition of done

A page is bilingual only when the language switcher works, all product-authored visible UI copy (including validation, loading, empty, error and success states) is translated, document language metadata updates, user content remains unchanged, and a Spanish-language smoke test covers the primary workflow. New features must include translation keys in the same pull request as their English UI copy.
