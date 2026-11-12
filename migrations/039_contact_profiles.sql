-- 039_contact_profiles.sql
-- Requester profiles are tenant-scoped and keyed by normalized email.
create table if not exists contact_profiles (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  email text not null,
  name text not null default '',
  phone text not null default '',
  title text not null default '',
  company_id bigint references clients(id) on delete set null,
  notes text not null default '',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, email),
  check (char_length(email) between 3 and 254),
  check (char_length(name) <= 100),
  check (char_length(phone) <= 60),
  check (char_length(title) <= 100),
  check (char_length(notes) <= 5000)
);
create index if not exists contact_profiles_org_name on contact_profiles(org_id, lower(name));
create index if not exists contact_profiles_org_company on contact_profiles(org_id, company_id);
alter table contact_profiles enable row level security;
alter table contact_profiles force row level security;
drop policy if exists contact_profiles_tenant on contact_profiles;
create policy contact_profiles_tenant on contact_profiles
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
