-- 053_cmdb_network_governance.sql
-- Authorized customer-side SNMPv3 discovery plus license reconciliation and compliance policies.
alter table configuration_items drop constraint if exists configuration_items_discovery_source_check;
alter table configuration_items add constraint configuration_items_discovery_source_check
  check(discovery_source is null or discovery_source in ('intune','windows_agent','osquery_agent','snmp_agent'));
alter table cmdb_discovery_runs drop constraint if exists cmdb_discovery_runs_provider_check;
alter table cmdb_discovery_runs add constraint cmdb_discovery_runs_provider_check
  check(provider in ('intune','windows_agent','osquery_agent','snmp_agent'));
alter table cmdb_discovery_agents add column if not exists network_device_count integer not null default 0;
alter table cmdb_discovery_agents add column if not exists last_network_scan_at timestamptz;
alter table cmdb_discovery_agents drop constraint if exists cmdb_discovery_agents_provider_check;
alter table cmdb_discovery_agents add constraint cmdb_discovery_agents_provider_check
  check(provider in ('windows_agent','osquery_agent','snmp_agent'));
alter table cmdb_discovery_agents drop constraint if exists cmdb_discovery_agents_platform_check;
alter table cmdb_discovery_agents add constraint cmdb_discovery_agents_platform_check
  check(platform in ('windows','darwin','linux','network',''));

-- Explicit aliases let admins reconcile vendor-specific application display names to a purchased entitlement.
create table if not exists cmdb_license_product_aliases (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 license_id bigint not null,
 normalized_name text not null check(char_length(normalized_name) between 1 and 240),
 display_name text not null check(char_length(display_name) between 1 and 240),
 created_by text,
 created_at timestamptz not null default now(),
 unique(org_id,id),
 unique(org_id,license_id,normalized_name),
 foreign key(org_id,license_id) references cmdb_software_licenses(org_id,id) on delete cascade
);
create index if not exists cmdb_license_alias_lookup on cmdb_license_product_aliases(org_id,normalized_name);
alter table cmdb_license_product_aliases enable row level security;
alter table cmdb_license_product_aliases force row level security;
drop policy if exists cmdb_license_product_aliases_tenant on cmdb_license_product_aliases;
create policy cmdb_license_product_aliases_tenant on cmdb_license_product_aliases
 using(org_id=current_setting('app.org_id',true))
 with check(org_id=current_setting('app.org_id',true));

create table if not exists cmdb_compliance_policies (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 160),
 description text not null default '' check(char_length(description)<=1000),
 enabled boolean not null default true,
 severity text not null default 'high' check(severity in ('low','medium','high','critical')),
 rules jsonb not null default '{}'::jsonb check(jsonb_typeof(rules)='object'),
 created_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id)
);
create unique index if not exists cmdb_compliance_policy_name_uq on cmdb_compliance_policies(org_id,lower(name));
create index if not exists cmdb_compliance_policy_enabled on cmdb_compliance_policies(org_id,enabled);
alter table cmdb_compliance_policies enable row level security;
alter table cmdb_compliance_policies force row level security;
drop policy if exists cmdb_compliance_policies_tenant on cmdb_compliance_policies;
create policy cmdb_compliance_policies_tenant on cmdb_compliance_policies
 using(org_id=current_setting('app.org_id',true))
 with check(org_id=current_setting('app.org_id',true));
