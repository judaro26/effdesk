# Help center and customer portal

Every organization gets a public help center at `https://app.effdesk.com/help/<organization slug>` (for example `/help/acme`), written in the desk under **Help center**.

## Articles
- English and Spanish. A Spanish article can be created as a **translation of** an English one; visitors then see the version in their language (from the browser, or the language links on the page) and each page links to the other versions.
- Text format: `# heading`, `**bold**`, `*italic*`, `- list`, `1. list`, `[link](https://…)`, `` `code` `` and ``` code blocks ```. Everything else is shown as plain text: authors cannot add HTML or scripts.
- Draft or published. Drafts are never visible to customers.
- Search looks in titles and text (in the visitor's language first). Each article counts views and "was this helpful" votes (one vote per visitor per article, remembered by a cookie).
- The pages use no JavaScript, so the strict content policy still holds.

## Customer portal ("My requests")
- Customers sign in with a link emailed to them, no password. The link works once, for 30 minutes. Opening it only shows a Continue button, so mail scanners that open links cannot use it up.
- A link is only sent to an address that already has a request with that organization (so the form cannot be used to email strangers). The page says the same thing either way, so nobody can find out who is a customer. At most 5 links an hour per address and 200 an hour per organization.
- Signed in (12 hours, cookie for `/help` only), a customer sees their own requests, the public conversation (never internal notes), and can reply. A reply reopens a solved ticket. A closed ticket cannot be replied to.
- Replies are protected by a form token and an origin check.

## Not built yet
- A customer cannot start a brand new request from the portal (they email the support address first, then use the portal). A web form needs spam protection that I did not want to guess at.
- Files in the portal are listed by name but cannot be downloaded or uploaded by customers.
- Agents are not emailed when a customer replies from the portal (they see it in the desk).
- A custom domain for the help center (help.theirdomain.com) and per-organization colors and logo.
- Article categories, and suggesting articles while a customer types a request.
