-- 038_external_issue_templates.sql
-- Workspace-owned forms for creating Linear and Jira issues from EffDesk tickets.
create table if not exists project_issue_templates (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check (provider in ('linear','jira')),
  name text not null,
  description text not null default '',
  project_id text not null,
  project_name text not null default '',
  issue_type_id text,
  issue_type_name text,
  form_config jsonb not null default '{"fields":[]}'::jsonb,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists project_issue_templates_name
  on project_issue_templates(org_id, provider, lower(name));
create index if not exists project_issue_templates_active
  on project_issue_templates(org_id, provider, active, sort_order, name);
alter table project_issue_templates enable row level security;
alter table project_issue_templates force row level security;
drop policy if exists project_issue_templates_tenant on project_issue_templates;
create policy project_issue_templates_tenant on project_issue_templates
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
