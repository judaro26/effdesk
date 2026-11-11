# Speed and scaling

`node scripts/bench.js 100000` seeds a throwaway Postgres with 100,000 tickets and 400,000 messages in one workspace (plus 30 small ones) and times the screens that run most. It is not part of `npm test`.

Median times on the first run, then after migration 022 (indexes) and the report rewrite:

| Screen | Before | After |
| --- | --- | --- |
| Ticket list | 65 ms | 22 ms |
| Page 200 of the list | 78 ms | 23 ms |
| Search by text | 88 ms | 22 ms |
| Search by email | 98 ms | 37 ms |
| Reports (30 days) | 1357 ms | 68 ms |
| Agent detail | 100 ms | 22 ms |
| Team list | 60 ms | 35 ms |

What was slow and why: the report counted tickets per day with 60 scans of the table (now one grouped query with a range index); the default list sorted all of a workspace's tickets on every open (now an index in the list's own order); searches read every row (now trigram indexes, `pg_trgm`).

## What to do in production
- Use Neon's **pooled** connection string (host with `-pooler`) for `DATABASE_URL`. Each function instance keeps at most 5 connections; the pooler multiplexes them.
- Keep the Netlify site and the Neon database in the same region. Every screen is a handful of database round trips, so distance costs more than any query.
- Look at Neon's query insights monthly. Anything over ~100 ms at your size is worth an index; add it as the next numbered migration and run `scripts/bench.js` first.
- Large workspaces: ticket lists page 50 at a time, exports come in parts of 300 tickets, reports cap the rows they read (`ROW_CAP`).

## Already in place
- A request looks up the plan and the custom role side by side; entering a workspace's context takes one round trip instead of two.
- Scripts and styles are cached by the browser for 5 minutes and refreshed in the background (netlify.toml).
- Everything per workspace is behind row level security with an index that starts with `org_id`, so one busy customer does not slow another.

## Next steps when needed
- A per-workspace ticket counter table (list tabs currently count with a group-by, about 20 ms at 100,000 tickets).
- Move email sending and webhooks to a queue (Netlify background functions) once volume makes them noticeable.
- Full-text search (`tsvector`) when searching message bodies.

## Speed measures (Nov 2026)
- Scripts and stylesheets are minified at deploy time (`scripts/minify-assets.js`, about 22% smaller before compression); the files in git stay readable. If minifying fails the deploy continues with the originals.
- Sign-in is built lazily per function instance, so the public help center, chat and health checks start without loading it.
- Each instance remembers a workspace's plan for 10 seconds (`ENT_CACHE_MS`, off outside Netlify; cleared at once by admin changes, licences and Paddle events on the same instance) and the session for 60 seconds (Better Auth cookie cache).
- Anonymous help pages are cached at the Netlify CDN for 60 seconds.
- Database pool: 10 connections per instance. `node scripts/profile-queries.js` prints how many queries the main requests make.
