-- 009_desk.sql: the desk features: ticket type, queues, CC, followers, merge, timeline, edited messages, clients with notes, linked problem/incident tickets, macros, saved views, side conversations. Every table carries org_id with row level security.
create table if not exists queues (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table if not exists clients (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  domain text not null default '' check (char_length(domain) <= 100),
  notes text not null default '' check (char_length(notes) <= 5000),
  share_tickets boolean not null default false,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table tickets add column if not exists type text not null default 'question';
alter table tickets add column if not exists queue_id bigint references queues(id) on delete set null;
alter table tickets add column if not exists client_id bigint references clients(id) on delete set null;
alter table tickets add column if not exists cc text[] not null default '{}';
alter table tickets add column if not exists merged_into integer;
alter table tickets add column if not exists problem_number integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_type_check') then
    alter table tickets add constraint tickets_type_check check (type in ('question','incident','problem','task'));
  end if;
end $$;
alter table ticket_messages add column if not exists edited_at timestamptz;
create index if not exists tickets_org_queue on tickets (org_id, queue_id);
create index if not exists tickets_org_client on tickets (org_id, client_id);
create index if not exists tickets_org_problem on tickets (org_id, problem_number);

create table if not exists ticket_followers (
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null references tickets(id) on delete cascade,
  user_id text not null,
  primary key (ticket_id, user_id)
);
create table if not exists ticket_events (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null references tickets(id) on delete cascade,
  actor_name text not null default '',
  kind text not null,
  detail text not null default '' check (char_length(detail) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists ticket_events_ticket on ticket_events (ticket_id, created_at);
create table if not exists macros (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 5000),
  status text check (status in ('open','pending','solved','closed')),
  priority text check (priority in ('low','normal','high','urgent')),
  add_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table if not exists saved_views (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  owner_id text,
  filter jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create table if not exists side_conversations (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null references tickets(id) on delete cascade,
  to_email text not null check (char_length(to_email) between 3 and 254),
  subject text not null check (char_length(subject) between 1 and 200),
  status text not null default 'open' check (status in ('open','closed')),
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists side_conversations_ticket on side_conversations (ticket_id);
create table if not exists side_messages (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  side_id bigint not null references side_conversations(id) on delete cascade,
  direction text not null check (direction in ('out','in')),
  author_name text not null default '',
  body text not null check (char_length(body) between 1 and 20000),
  message_id text,
  created_at timestamptz not null default now()
);
create index if not exists side_messages_side on side_messages (side_id, created_at);
do $$ declare t text; begin
  foreach t in array array['queues','clients','ticket_followers','ticket_events','macros','saved_views','side_conversations','side_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
