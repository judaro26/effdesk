-- 052_cmdb_cross_platform_discovery.sql
-- Extend the tenant-scoped customer-installed discovery agent to osquery on macOS/Linux.
alter table configuration_items drop constraint if exists configuration_items_discovery_source_check;
alter table configuration_items add constraint configuration_items_discovery_source_check
  check(discovery_source is null or discovery_source in ('intune','windows_agent','osquery_agent'));
alter table cmdb_discovery_runs drop constraint if exists cmdb_discovery_runs_provider_check;
alter table cmdb_discovery_runs add constraint cmdb_discovery_runs_provider_check
  check(provider in ('intune','windows_agent','osquery_agent'));

alter table cmdb_discovery_agents
  add column if not exists provider text not null default 'windows_agent',
  add column if not exists platform text not null default 'windows';
alter table cmdb_discovery_agents drop constraint if exists cmdb_discovery_agents_provider_check;
alter table cmdb_discovery_agents add constraint cmdb_discovery_agents_provider_check
  check(provider in ('windows_agent','osquery_agent'));
alter table cmdb_discovery_agents drop constraint if exists cmdb_discovery_agents_platform_check;
alter table cmdb_discovery_agents add constraint cmdb_discovery_agents_platform_check
  check(platform in ('windows','darwin','linux',''));

create index if not exists cmdb_discovery_agents_provider_seen
  on cmdb_discovery_agents(org_id,provider,last_seen_at desc);
