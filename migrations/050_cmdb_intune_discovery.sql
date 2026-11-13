-- 050_cmdb_intune_discovery.sql
-- Microsoft Intune discovery credentials and inventory are isolated by workspace.
alter table configuration_items add column if not exists discovery_source text;
alter table configuration_items add column if not exists discovery_external_id text;
alter table configuration_items add column if not exists discovery_status text not null default 'manual';
alter table configuration_items add column if not exists discovery_last_seen_at timestamptz;
alter table configuration_items add column if not exists operating_system text not null default '';
alter table configuration_items add column if not exists os_version text not null default '';
alter table configuration_items add column if not exists compliance_state text not null default '';
do $cmdb$ begin
 if not exists(select 1 from pg_constraint where conname='configuration_items_discovery_source_check') then
  alter table configuration_items add constraint configuration_items_discovery_source_check check(discovery_source is null or discovery_source in ('intune'));
 end if;
 if not exists(select 1 from pg_constraint where conname='configuration_items_discovery_status_check') then
  alter table configuration_items add constraint configuration_items_discovery_status_check check(discovery_status in ('manual','current','missing','disconnected'));
 end if;
end $cmdb$;
create unique index if not exists configuration_items_discovery_external_uq
 on configuration_items(org_id,discovery_source,discovery_external_id)
 where discovery_source is not null and discovery_external_id is not null;
create index if not exists configuration_items_discovery_seen_idx
 on configuration_items(org_id,discovery_source,discovery_last_seen_at);

create table if not exists cmdb_discovery_connections (
 org_id text primary key references "organization"(id) on delete cascade,
 provider text not null default 'intune' check(provider='intune'),
 tenant_id text not null check(char_length(tenant_id) between 3 and 120),
 access_token_enc text not null,
 refresh_token_enc text,
 expires_at timestamptz,
 granted_scopes text not null default '',
 connected_by text,
 connected_at timestamptz not null default now(),
 last_sync_at timestamptz,
 last_sync_count integer not null default 0,
 last_sync_error text not null default '',
 updated_at timestamptz not null default now()
);
alter table cmdb_discovery_connections enable row level security;
alter table cmdb_discovery_connections force row level security;
drop policy if exists cmdb_discovery_connections_tenant on cmdb_discovery_connections;
create policy cmdb_discovery_connections_tenant on cmdb_discovery_connections
 using(org_id=current_setting('app.org_id',true))
 with check(org_id=current_setting('app.org_id',true));

-- OAuth state is short-lived, single-use and keyed by a SHA-256 hash. It intentionally
-- has no user-facing read path and stores the PKCE verifier encrypted at rest.
create table if not exists cmdb_discovery_oauth_states (
 state_hash text primary key,
 org_id text not null references "organization"(id) on delete cascade,
 user_id text not null,
 tenant_id text not null,
 verifier_enc text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index if not exists cmdb_discovery_oauth_expiry_idx on cmdb_discovery_oauth_states(expires_at);

create table if not exists cmdb_discovery_runs (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 provider text not null default 'intune' check(provider='intune'),
 started_at timestamptz not null default now(),
 completed_at timestamptz,
 discovered integer not null default 0,
 created integer not null default 0,
 updated integer not null default 0,
 marked_missing integer not null default 0,
 status text not null default 'running' check(status in ('running','completed','failed')),
 error text not null default ''
);
create index if not exists cmdb_discovery_runs_org_started on cmdb_discovery_runs(org_id,started_at desc);
alter table cmdb_discovery_runs enable row level security;
alter table cmdb_discovery_runs force row level security;
drop policy if exists cmdb_discovery_runs_tenant on cmdb_discovery_runs;
create policy cmdb_discovery_runs_tenant on cmdb_discovery_runs
 using(org_id=current_setting('app.org_id',true))
 with check(org_id=current_setting('app.org_id',true));
