-- 056_scim_provisioning.sql
-- SCIM token registry is global only so a bearer token can resolve its tenant before RLS context is set.
-- It contains a SHA-256 digest only; raw credentials are returned once at creation.
create table if not exists scim_tokens (
  id text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  created_by text references "user"(id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index if not exists scim_tokens_org_idx on scim_tokens(org_id,created_at desc);

-- Per-tenant SCIM identity mappings. The shared Better Auth user is never deleted on deprovision.
create table if not exists scim_users (
  id text not null,
  org_id text not null references "organization"(id) on delete cascade,
  user_id text not null references "user"(id) on delete cascade,
  external_id text,
  active boolean not null default true,
  display_name text,
  given_name text,
  family_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id,id),
  unique (org_id,user_id),
  unique (org_id,external_id)
);
create index if not exists scim_users_org_updated_idx on scim_users(org_id,updated_at desc);
alter table scim_users enable row level security;
alter table scim_users force row level security;
drop policy if exists scim_users_tenant on scim_users;
create policy scim_users_tenant on scim_users
  using (org_id=current_setting('app.org_id',true))
  with check (org_id=current_setting('app.org_id',true));
