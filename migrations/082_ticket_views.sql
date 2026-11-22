-- 082_ticket_views.sql
-- Per-agent ticket viewing history, kept separate from ticket status and reply/unread state.
-- Treat pre-existing tickets as historical rather than falsely highlighting them as new.
alter table tickets add column if not exists agent_viewed_at timestamptz;
update tickets set agent_viewed_at=now() where agent_viewed_at is null;
create table if not exists ticket_views (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null,
  user_id text not null,
  agent_name text not null default '',
  agent_email text not null default '',
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  view_count integer not null default 1 check (view_count > 0),
  unique (org_id, ticket_id, user_id),
  foreign key (org_id, ticket_id) references tickets (org_id, id) on delete cascade
);
create index if not exists ticket_views_org_ticket_last
  on ticket_views (org_id, ticket_id, last_viewed_at desc);
alter table ticket_views enable row level security;
alter table ticket_views force row level security;
drop policy if exists ticket_views_tenant on ticket_views;
create policy ticket_views_tenant on ticket_views
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
