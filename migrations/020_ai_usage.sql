-- 020_ai_usage.sql: how many AI assists an organization has used this month (a cap keeps the cost predictable).
create table if not exists ai_usage (
  org_id text not null references "organization"(id) on delete cascade,
  month text not null,
  calls integer not null default 0,
  primary key (org_id, month)
);
alter table ai_usage enable row level security;
alter table ai_usage force row level security;
drop policy if exists ai_usage_tenant on ai_usage;
create policy ai_usage_tenant on ai_usage using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
