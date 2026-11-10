-- 003_tickets.sql: the ticket core. Every table carries org_id and is protected by row level security (see 002_core.sql).
create table if not exists ticket_counters (
  org_id text primary key references "organization"(id) on delete cascade,
  last_number integer not null default 0
);
create table if not exists tickets (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  number integer not null,
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'open' check (status in ('open','pending','solved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  channel text not null default 'web' check (channel in ('web','email','api')),
  requester_name text not null default '',
  requester_email text not null check (char_length(requester_email) between 3 and 254),
  assignee_id text,
  tags text[] not null default '{}',
  first_response_at timestamptz,
  solved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, number)
);
create index if not exists tickets_org_status on tickets (org_id, status, updated_at desc);
create index if not exists tickets_org_assignee on tickets (org_id, assignee_id);
create table if not exists ticket_messages (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null references tickets(id) on delete cascade,
  kind text not null check (kind in ('requester','agent','note','system')),
  author_id text,
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 20000),
  created_at timestamptz not null default now()
);
create index if not exists ticket_messages_ticket on ticket_messages (ticket_id, created_at);
do $$ declare t text; begin
  foreach t in array array['ticket_counters','tickets','ticket_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
