-- 054_integration_connections.sql
-- Customer-owned credentials for provider adapters. Secret material is encrypted by the app
-- and every row is protected by forced organization-scoped RLS.
create table if not exists integration_connections (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null,
  status text not null default 'connected' check (status in ('connected','degraded','error')),
  credentials_enc text not null,
  account_id text,
  account_username text,
  account_name text,
  granted_scopes text[] not null default '{}',
  last_success_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  created_by text references "user"(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider)
);
create index if not exists integration_connections_org_updated_idx
  on integration_connections (org_id, updated_at desc);
alter table integration_connections enable row level security;
alter table integration_connections force row level security;
drop policy if exists integration_connections_tenant on integration_connections;
create policy integration_connections_tenant on integration_connections
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
