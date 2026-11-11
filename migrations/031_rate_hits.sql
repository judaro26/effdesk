-- 031: a shared counter for rate limits (one row per caller key and time window), so limits hold across every function instance
create table if not exists rate_hits (
  key text not null,
  win bigint not null,
  n integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (key, win)
);
create index if not exists rate_hits_created_idx on rate_hits (created_at);
-- API tokens: look up by hash without scanning
create index if not exists api_tokens_hash_idx on api_tokens (hash);
-- the customer portal looks tickets up by requester address (list, sign-in link, reply)
create index if not exists tickets_org_requester on tickets (org_id, requester_email, updated_at desc);
-- the help center search is a substring match: trigram indexes keep it fast as articles grow
create extension if not exists pg_trgm;
create index if not exists help_articles_title_trgm on help_articles using gin (title gin_trgm_ops);
create index if not exists help_articles_text_trgm on help_articles using gin ((coalesce(plain, body)) gin_trgm_ops);
