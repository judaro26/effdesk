-- 036_external_issue_integrations.sql
-- Workspace-scoped OAuth connections and idempotent links between EffDesk tickets and external issues.
create table if not exists project_integrations (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check (provider in ('linear','jira')),
  access_token_enc text not null,
  refresh_token_enc text,
  expires_at timestamptz,
  external_workspace_id text,
  external_workspace_name text,
  webhook_secret_enc text,
  webhook_url_token_hash text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, provider)
);
alter table project_integrations enable row level security;
alter table project_integrations force row level security;
drop policy if exists project_integrations_tenant on project_integrations;
create policy project_integrations_tenant on project_integrations
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

create table if not exists project_issue_links (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check (provider in ('linear','jira')),
  ticket_number bigint not null,
  external_issue_id text not null,
  external_issue_key text,
  external_issue_url text,
  external_project_id text,
  last_synced_at timestamptz,
  last_external_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, ticket_number),
  unique (org_id, provider, external_issue_id)
);
alter table project_issue_links enable row level security;
alter table project_issue_links force row level security;
drop policy if exists project_issue_links_tenant on project_issue_links;
create policy project_issue_links_tenant on project_issue_links
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

create table if not exists project_sync_events (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check (provider in ('linear','jira')),
  event_id text not null,
  processed_at timestamptz not null default now(),
  primary key (org_id, provider, event_id)
);
alter table project_sync_events enable row level security;
alter table project_sync_events force row level security;
drop policy if exists project_sync_events_tenant on project_sync_events;
create policy project_sync_events_tenant on project_sync_events
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

create table if not exists project_oauth_states (
  state_hash text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  user_id text not null,
  provider text not null check (provider in ('linear','jira')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists project_oauth_states_expiry on project_oauth_states(expires_at);

alter table project_integrations add column if not exists webhook_url_token_enc text;
