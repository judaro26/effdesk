-- 008_signup.sql: what a person chose when they registered (company and workspace address) until they confirm their email and pick a plan; the address is held for them for 7 days.
create table if not exists pending_signups (
  user_id text primary key references "user"(id) on delete cascade,
  company text not null check (char_length(company) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  created_at timestamptz not null default now()
);
