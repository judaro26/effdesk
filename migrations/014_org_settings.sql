-- 014_org_settings.sql: small per-organization switches (for now: whether customers are asked to rate their support).
create table if not exists org_settings (
  org_id text primary key references "organization"(id) on delete cascade,
  csat_on boolean not null default true
);
alter table org_settings enable row level security;
alter table org_settings force row level security;
drop policy if exists org_settings_tenant on org_settings;
create policy org_settings_tenant on org_settings using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
