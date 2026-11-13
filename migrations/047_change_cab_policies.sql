-- 047_change_cab_policies.sql
-- Per-tenant CAB rules for approval thresholds and maintenance-window conflict handling.
create table if not exists change_cab_policies (
 org_id text primary key references "organization"(id) on delete cascade,
 policy jsonb not null default '{}'::jsonb,
 updated_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table change_cab_policies enable row level security;
alter table change_cab_policies force row level security;
drop policy if exists change_cab_policies_tenant on change_cab_policies;
create policy change_cab_policies_tenant on change_cab_policies
 using (org_id=current_setting('app.org_id',true))
 with check (org_id=current_setting('app.org_id',true));
