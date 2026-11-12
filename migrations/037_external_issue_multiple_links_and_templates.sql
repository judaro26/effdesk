-- 037_external_issue_multiple_links_and_templates.sql
-- A ticket may be associated with several Linear/Jira issues. Templates are tenant-owned.
alter table project_issue_links
  drop constraint if exists project_issue_links_org_id_provider_ticket_number_key;
create index if not exists project_issue_links_ticket_lookup
  on project_issue_links(org_id, ticket_number, provider);

create table if not exists project_issue_templates (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check (provider in ('linear','jira')),
  name text not null,
  project_id text not null,
  issue_type_id text,
  defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id, provider, name)
);
alter table project_issue_templates enable row level security;
alter table project_issue_templates force row level security;
drop policy if exists project_issue_templates_tenant on project_issue_templates;
create policy project_issue_templates_tenant on project_issue_templates
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
