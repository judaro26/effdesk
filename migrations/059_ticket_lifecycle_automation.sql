-- 059_ticket_lifecycle_automation.sql
-- Tenant-owned ticket lifecycle policies and idempotent scheduler action ledger.
alter table tickets add column if not exists closed_at timestamptz;
alter table tickets add column if not exists lifecycle_parent_ticket_id bigint;
update tickets set closed_at = updated_at where status = 'closed' and closed_at is null;
create index if not exists tickets_lifecycle_due on tickets(org_id,status,solved_at,updated_at);
create table if not exists ticket_lifecycle_policies (
  org_id text primary key references "organization"(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
create table if not exists ticket_lifecycle_runs (
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null,
  action_key text not null,
  executed_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  primary key(org_id,ticket_id,action_key),
  foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists ticket_lifecycle_runs_recent on ticket_lifecycle_runs(org_id,executed_at desc);
do $$
declare t text;
begin
 foreach t in array array['ticket_lifecycle_policies','ticket_lifecycle_runs'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
