-- 024_routing_presence.sql: automatic assignment of new tickets, who is available, and who is looking at which ticket right now.
create table if not exists routing_settings (
  org_id text primary key references "organization"(id) on delete cascade,
  enabled boolean not null default false,
  strategy text not null default 'round_robin' check (strategy in ('round_robin','least_busy')),
  max_open integer check (max_open is null or max_open between 1 and 500),
  updated_at timestamptz not null default now()
);
create table if not exists agent_status (
  org_id text not null references "organization"(id) on delete cascade,
  user_id text not null,
  available boolean not null default true,
  last_assigned_at timestamptz,
  primary key (org_id, user_id)
);
create table if not exists ticket_presence (
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null references tickets(id) on delete cascade,
  user_id text not null,
  name text not null default '',
  typing boolean not null default false,
  seen_at timestamptz not null default now(),
  primary key (ticket_id, user_id)
);
do $$ declare t text; begin
  foreach t in array array['routing_settings','agent_status','ticket_presence'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
create index if not exists ticket_presence_seen on ticket_presence (org_id, seen_at);
