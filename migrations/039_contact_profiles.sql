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

-- Backfill profiles for requesters already present in the ticket history.
insert into contact_profiles(org_id,email,name,company_id,last_seen_at)
select distinct on (t.org_id, lower(trim(t.requester_email)))
  t.org_id, lower(trim(t.requester_email)), coalesce(nullif(t.requester_name,''),''), k.id, max(t.updated_at) over (partition by t.org_id, lower(trim(t.requester_email)))
from tickets t
left join clients k on k.org_id=t.org_id and k.domain<>'' and lower(k.domain)=lower(split_part(trim(t.requester_email),'@',2))
where t.requester_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
order by t.org_id, lower(trim(t.requester_email)), (t.requester_name<>'') desc, t.updated_at desc, k.id asc
on conflict(org_id,email) do nothing;

-- Ensure historical tickets follow the same domain-based company association.
update tickets t set client_id=(select min(k.id) from clients k where k.org_id=t.org_id and k.domain<>'' and lower(k.domain)=lower(split_part(trim(t.requester_email),'@',2)))
where t.client_id is null and exists (select 1 from clients k where k.org_id=t.org_id and k.domain<>'' and lower(k.domain)=lower(split_part(trim(t.requester_email),'@',2)));
