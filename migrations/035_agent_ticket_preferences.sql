-- 035_agent_ticket_preferences.sql
-- Personal ticket-list filters and column layout are scoped to both the agent and workspace.
create table if not exists agent_ticket_preferences (
  org_id text not null references "organization"(id) on delete cascade,
  user_id text not null,
  filters jsonb not null default '{"status":"active","assignee":"","q":""}'::jsonb,
  columns jsonb not null default '["status","number","subject","requester","priority","assignee","updated"]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table agent_ticket_preferences enable row level security;
alter table agent_ticket_preferences force row level security;
drop policy if exists agent_ticket_preferences_tenant on agent_ticket_preferences;
create policy agent_ticket_preferences_tenant on agent_ticket_preferences
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
