# Registration to first workspace

1. **Register** (`/auth.html?mode=signup`): name, company name, workspace address, email, password, agreement. The address is checked live against every address already used by a workspace or held by someone who has registered but not finished (held for 7 days), and against reserved words (www, app, admin, help, ...). It is checked again on the server when the form is sent.
2. **Confirmation page**: the form is replaced by "Check your email" with the address it was sent to, the workspace address, and a button to send the email again.
3. **The email**: a designed HTML email (all system emails share the same design: confirmation, password reset, invitation, customer sign-in link). The button goes to `/api/auth/verify-email` and then to `/welcome.html`, signed in. A link that lands on the wrong page of the site (for example an older email) is passed on by `js/rescue.js`.
4. **Choose a plan** (`/welcome.html`): Free (2 agents, no card) or Team, Suite, Pro with the number of agents and yearly or monthly billing. The workspace address can still be changed here.
5. **The workspace is created** when a plan is chosen: the organization (company name and address, the person as owner), its support address (`<address>@in.effdesk.com`, replies back into the ticket, the company as sender name) and the free plan.
6. **Paid plans**: Paddle's secure window takes the billing details and payment. When it completes, the page waits until Paddle's webhook has activated the plan, then opens the desk. If the window is closed, the workspace stays on the free plan and the page offers to retry or open the desk.
7. **Every sign-in goes through `/welcome.html`**, which sends people where they belong: the plan page if a workspace is waiting, the desk if they have one, the account page otherwise.

## Workspace addresses today
The address is used in the help center URL (`app.effdesk.com/help/<address>`) and as the default support address. A **separate subdomain per customer** (`<address>.effdesk.com`) is not set up: it needs wildcard DNS and a wildcard domain on the Netlify site (check that your Netlify plan allows wildcard domains), plus routing by host name. It is a contained change on top of this, tell me if you want it.

## Accounts created before this flow existed
They have no waiting workspace, so signing in sends them to the account page, where they can create an organization the old way.
