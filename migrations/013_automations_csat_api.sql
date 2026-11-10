-- 013_automations_csat_api.sql: triggers and time-based automations, customer satisfaction ratings, API tokens, and the kind of a webhook (json, slack, teams).
create table if not exists triggers (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null,
  event text not null check (event in ('created','customer_reply','time')),
  conditions jsonb not null default '[]',
  actions jsonb not null default '[]',
  once boolean not null default true,
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists trigger_runs (
  trigger_id bigint not null references triggers(id) on delete cascade,
  ticket_id bigint not null references tickets(id) on delete cascade,
  ran_at timestamptz not null default now(),
  primary key (trigger_id, ticket_id)
);
create table if not exists csat_ratings (
  ticket_id bigint primary key references tickets(id) on delete cascade,
  org_id text not null references "organization"(id) on delete cascade,
  sent_at timestamptz not null default now(),
  rating smallint check (rating in (0,1)),
  comment text not null default '',
  rated_at timestamptz
);
create table if not exists api_tokens (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null,
  prefix text not null,
  hash text not null unique,
  created_by text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table webhooks add column if not exists kind text not null default 'json' check (kind in ('json','slack','teams'));
do $$ declare t text; begin
  foreach t in array array['triggers','csat_ratings','api_tokens'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
