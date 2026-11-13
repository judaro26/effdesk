-- 045_problem_management.sql
-- Tenant-scoped problem records, incident associations and an auditable problem activity stream.
create table if not exists problems (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  title text not null check(char_length(title) between 1 and 180),
  description text not null default '' check(char_length(description)<=5000),
  status text not null default 'open' check(status in ('open','investigating','known_error','resolved','closed')),
  priority text not null default 'P3' check(priority in ('P1','P2','P3','P4')),
  known_error boolean not null default false,
  root_cause text not null default '' check(char_length(root_cause)<=5000),
  workaround text not null default '' check(char_length(workaround)<=5000),
  resolution text not null default '' check(char_length(resolution)<=5000),
  owner_id text,
  created_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id)
);
create index if not exists problems_org_status_priority on problems(org_id,status,priority,updated_at desc);
create index if not exists problems_org_owner on problems(org_id,owner_id,status);
create table if not exists problem_incidents (
  org_id text not null,
  problem_id bigint not null,
  ticket_id bigint not null,
  created_at timestamptz not null default now(),
  primary key(org_id,problem_id,ticket_id),
  foreign key(org_id,problem_id) references problems(org_id,id) on delete cascade,
  foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists problem_incidents_ticket on problem_incidents(org_id,ticket_id,problem_id);
create table if not exists problem_events (
  id bigserial primary key,
  org_id text not null,
  problem_id bigint not null,
  actor_id text,
  actor_name text not null default '',
  event text not null check(event in ('created','updated','status_changed','incident_linked','incident_unlinked')),
  detail text not null default '' check(char_length(detail)<=2000),
  created_at timestamptz not null default now(),
  foreign key(org_id,problem_id) references problems(org_id,id) on delete cascade
);
create index if not exists problem_events_org_problem on problem_events(org_id,problem_id,created_at desc);
do $$
declare t text;
begin
 foreach t in array array['problems','problem_incidents','problem_events'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
