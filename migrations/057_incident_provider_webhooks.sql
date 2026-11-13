-- 057_incident_provider_webhooks.sql
-- Tenant-owned inbound incident webhooks. The tiny hash registry is intentionally global
-- so a bearer secret can identify its tenant before RLS context is established; it contains
-- no plaintext secrets and is accessed only by the server-side webhook handler.
create table if not exists incident_provider_connections (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check(provider in ('pagerduty','rootly','firehydrant')),
  name text not null check(char_length(name) between 1 and 100),
  active boolean not null default true,
  last_status text,
  last_at timestamptz,
  last_error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id)
);
create unique index if not exists incident_provider_one_active
  on incident_provider_connections(org_id,provider) where active=true;
create table if not exists incident_provider_token_registry (
  token_hash text primary key check(char_length(token_hash)=64),
  org_id text not null references "organization"(id) on delete cascade,
  connection_id bigint not null,
  provider text not null check(provider in ('pagerduty','rootly','firehydrant')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(org_id,connection_id) references incident_provider_connections(org_id,id) on delete cascade
);
create index if not exists incident_provider_token_lookup on incident_provider_token_registry(provider,active);
create table if not exists incident_provider_links (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check(provider in ('pagerduty','rootly','firehydrant')),
  external_incident_id text not null,
  ticket_id bigint not null,
  external_url text,
  external_status text,
  external_severity text,
  external_owner text,
  external_service text,
  external_escalation text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(org_id,provider,external_incident_id),
  foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists incident_provider_links_ticket on incident_provider_links(org_id,ticket_id);
create table if not exists incident_provider_events (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check(provider in ('pagerduty','rootly','firehydrant')),
  event_id text not null,
  external_incident_id text not null,
  received_at timestamptz not null default now(),
  primary key(org_id,provider,event_id)
);
do $$
declare t text;
begin
 foreach t in array array['incident_provider_connections','incident_provider_links','incident_provider_events'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
