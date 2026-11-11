-- 028_custom_statuses.sql: each workspace's own ticket statuses. A custom status always belongs to one of the four built-in ones (its category), and the ticket keeps that category in tickets.status, so SLA clocks, reports, counts and automations work unchanged.
create table if not exists ticket_statuses (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  category text not null check (category in ('open','pending','solved','closed')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table ticket_statuses enable row level security;
alter table ticket_statuses force row level security;
drop policy if exists ticket_statuses_tenant on ticket_statuses;
create policy ticket_statuses_tenant on ticket_statuses using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
alter table tickets add column if not exists custom_status_id bigint references ticket_statuses(id) on delete set null;
