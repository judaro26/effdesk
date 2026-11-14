-- Per-agent chat concurrency cap used by auto-routing and atomic manual claims.
alter table chat_settings add column if not exists max_concurrent integer not null default 3;
