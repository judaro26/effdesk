-- 015_hours_alerts_fields.sql: business hours for SLA clocks, one alert per ticket per SLA state, and custom ticket fields.
create table if not exists sla_hours (
  org_id text primary key references "organization"(id) on delete cascade,
  enabled boolean not null default false,
  tz text not null default 'UTC',
  schedule jsonb not null default '{}'
);
create table if not exists sla_alerts (
  ticket_id bigint not null references tickets(id) on delete cascade,
  org_id text not null references "organization"(id) on delete cascade,
  kind text not null check (kind in ('risk','breached')),
  sent_at timestamptz not null default now(),
  primary key (ticket_id, kind)
);
create table if not exists custom_fields (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null check (type in ('text','number','dropdown','checkbox','date')),
  options text[] not null default '{}',
  position integer not null default 0,
  unique (org_id, key)
);
alter table tickets add column if not exists custom jsonb not null default '{}';
do $$ declare t text; begin
  foreach t in array array['sla_hours','sla_alerts','custom_fields'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
