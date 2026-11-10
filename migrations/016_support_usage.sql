-- 016_support_usage.sql: customer-granted support access (time limited), a daily usage summary per organization, and usage alerts already sent.
-- These are platform tables (like subscriptions): the platform owner reads them across organizations, so they carry no row security.
create table if not exists support_access (
  org_id text primary key references "organization"(id) on delete cascade,
  granted_by text not null,
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists usage_daily (
  org_id text not null references "organization"(id) on delete cascade,
  day date not null,
  tickets integer not null default 0,
  replies integer not null default 0,
  agents integer not null default 0,
  active_agents integer not null default 0,
  api_calls integer not null default 0,
  primary key (org_id, day)
);
create table if not exists usage_alerts (
  org_id text not null references "organization"(id) on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now(),
  primary key (org_id, kind)
);
