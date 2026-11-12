-- 037_tenant_managed_oauth_apps.sql
-- Optional tenant-owned OAuth app credentials. Secrets are encrypted by the application.
create table if not exists project_integration_apps (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check (provider in ('linear','jira')),
  client_id_enc text not null,
  client_secret_enc text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);
alter table project_integration_apps enable row level security;
alter table project_integration_apps force row level security;
drop policy if exists project_integration_apps_tenant on project_integration_apps;
create policy project_integration_apps_tenant on project_integration_apps
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
