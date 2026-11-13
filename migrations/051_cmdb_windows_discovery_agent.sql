-- 051_cmdb_windows_discovery_agent.sql
-- Tenant-scoped, customer-installed Windows discovery agents. Tokens are hashed; plaintext is shown once.
alter table configuration_items drop constraint if exists configuration_items_discovery_source_check;
alter table configuration_items add constraint configuration_items_discovery_source_check
  check(discovery_source is null or discovery_source in ('intune','windows_agent'));
alter table cmdb_discovery_runs drop constraint if exists cmdb_discovery_runs_provider_check;
alter table cmdb_discovery_runs add constraint cmdb_discovery_runs_provider_check
  check(provider in ('intune','windows_agent'));

create table if not exists cmdb_discovery_agents (
 id uuid primary key default gen_random_uuid(),
 org_id text not null references "organization"(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 120),
 token_hash text not null unique,
 created_by text,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 revoked_at timestamptz,
 last_seen_at timestamptz,
 last_sync_status text not null default 'never' check(last_sync_status in ('never','success','failed')),
 last_sync_error text not null default '',
 hostname text not null default '',
 manufacturer text not null default '',
 model text not null default '',
 serial_number text not null default '',
 os_version text not null default '',
 software_count integer not null default 0,
 unique(org_id,id)
);
create index if not exists cmdb_discovery_agents_org_seen on cmdb_discovery_agents(org_id,last_seen_at desc);
alter table cmdb_discovery_agents enable row level security;
alter table cmdb_discovery_agents force row level security;
drop policy if exists cmdb_discovery_agents_tenant on cmdb_discovery_agents;
create policy cmdb_discovery_agents_tenant on cmdb_discovery_agents
 using(org_id=current_setting('app.org_id',true))
 with check(org_id=current_setting('app.org_id',true));

create table if not exists cmdb_discovered_software (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 agent_id uuid not null,
 name text not null check(char_length(name) between 1 and 240),
 publisher text not null default '' check(char_length(publisher)<=180),
 version text not null default '' check(char_length(version)<=100),
 normalized_name text not null,
 status text not null default 'current' check(status in ('current','missing')),
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,agent_id) references cmdb_discovery_agents(org_id,id) on delete cascade
);
create unique index if not exists cmdb_discovered_software_identity
 on cmdb_discovered_software(org_id,agent_id,normalized_name,version);
create index if not exists cmdb_discovered_software_search
 on cmdb_discovered_software(org_id,lower(name));
alter table cmdb_discovered_software enable row level security;
alter table cmdb_discovered_software force row level security;
drop policy if exists cmdb_discovered_software_tenant on cmdb_discovered_software;
create policy cmdb_discovered_software_tenant on cmdb_discovered_software
 using(org_id=current_setting('app.org_id',true))
 with check(org_id=current_setting('app.org_id',true));
