-- Per-agent, role and team Live Chat concurrency overrides.
-- One agent belongs to at most one Live Chat team so precedence is deterministic.
create table if not exists chat_teams (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name),
  unique (org_id, id)
);
create table if not exists chat_team_members (
  org_id text not null references "organization"(id) on delete cascade,
  team_id bigint not null,
  user_id text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id),
  foreign key (org_id, team_id) references chat_teams(org_id, id) on delete cascade
);
create table if not exists chat_capacity_rules (
  org_id text not null references "organization"(id) on delete cascade,
  scope_type text not null check (scope_type in ('agent','role','team')),
  scope_id text not null,
  max_concurrent integer not null check (max_concurrent between 1 and 10),
  updated_at timestamptz not null default now(),
  primary key (org_id, scope_type, scope_id)
);
do $$ declare t text; begin
  foreach t in array array['chat_teams','chat_team_members','chat_capacity_rules'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
create index if not exists chat_team_members_team_idx on chat_team_members (org_id, team_id, user_id);
create index if not exists chat_capacity_rules_scope_idx on chat_capacity_rules (org_id, scope_type, scope_id);
