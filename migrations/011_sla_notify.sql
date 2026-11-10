-- 011_sla_notify.sql: SLA targets per priority, and agent notifications (a per-person switch, plus a log so one busy ticket does not send an email per message).
alter table desk_prefs add column if not exists notify boolean not null default true;
create table if not exists desk_notify_log (
  user_id text not null,
  ticket_id bigint not null references tickets(id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (user_id, ticket_id)
);
create table if not exists sla_policies (
  org_id text not null references "organization"(id) on delete cascade,
  priority text not null check (priority in ('low','normal','high','urgent')),
  first_response_min integer check (first_response_min between 1 and 525600),
  resolve_min integer check (resolve_min between 1 and 525600),
  primary key (org_id, priority)
);
alter table sla_policies enable row level security;
alter table sla_policies force row level security;
drop policy if exists sla_policies_tenant on sla_policies;
create policy sla_policies_tenant on sla_policies using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
