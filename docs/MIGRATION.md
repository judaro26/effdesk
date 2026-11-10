# Moving mdv's support desk to EffDesk

Goal: mdv's agents work in EffDesk (on the lifetime licence), with all existing tickets and help articles carried over, then the embedded portal in the mdv repository is retired.

## Steps
1. **Create the mdv organization in EffDesk.** Sign up at https://app.effdesk.com with the email set in `PLATFORM_ADMIN_EMAILS`, confirm the email, and create an organization named mdv with the slug `mdv`.
2. **Grant the lifetime licence.** Open https://app.effdesk.com/admin.html, enter `mdv` and Grant. (Unlimited agents, every feature, not affected by Paddle.)
3. **Invite the mdv agents** from the account page. Agents must have accepted the invitation *before* the import if you want imported tickets to keep their assignee (the match is by email address).
4. **Export from mdv.** In the mdv console: Settings → Export for EffDesk (from the mdv pull request that adds it). It downloads one JSON file with every ticket (with messages and internal notes) and every help article. Nothing is changed in mdv.
5. **Check, then import.** On the admin page choose the file, enter `mdv`, press **Check first** (writes nothing, shows what would happen and why anything is skipped), then **Import**. The file is sent in batches of 100. Repeating an import never duplicates anything.
6. **Move the mail.** Set up the support address in EffDesk (docs/EMAIL.md) and point mdv's customer-facing support address at it (forward or change the address mdv's portal mails from).
7. **Run both for a short overlap**, then switch the "Contact mdv" section of the client portal to link to the EffDesk help center / portal, and retire the old Tickets tab.

## What carries over
Ticket numbers (a clash gets the next free number, and the warning says so), subject, priority, status (open → open, waiting and on hold → pending, solved → solved, cancelled → closed), requester, assignee (by email), labels, category and workspace as tags, every message in order with its author and time, internal notes as internal notes, the first response time, solved time. Help articles with language, published state, votes and translation links.

## What does not carry over (said plainly in the import result and on each ticket)
- **Files attached to old tickets** are not copied: each affected ticket gets a note listing their names. They remain in mdv's storage.
- Satisfaction ratings, SLA clocks and history, macros, rules and views are not imported (rebuild what is still needed).
- Article text is copied as typed. If it used characters that EffDesk's text format treats as formatting (`*`, `#`, `[ ]( )`), skim the published articles once.
