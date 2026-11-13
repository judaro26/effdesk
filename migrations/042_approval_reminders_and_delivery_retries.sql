-- 042_approval_reminders_and_delivery_retries.sql
-- Persist per-workflow reminder policy, prevent overlapping reminder workers, and make approval email delivery retryable.
alter table approval_requests add column if not exists reminder_interval_hours integer not null default 24 check(reminder_interval_hours between 1 and 720);
alter table approval_requests add column if not exists max_reminders integer not null default 3 check(max_reminders between 0 and 20);
alter table approval_requests add column if not exists reminder_count integer not null default 0 check(reminder_count between 0 and 20);
alter table approval_requests add column if not exists last_reminded_at timestamptz;
alter table approval_requests add column if not exists reminder_claimed_at timestamptz;
create index if not exists approval_requests_reminder_due on approval_requests(org_id,status,last_reminded_at,created_at) where status='pending' and max_reminders>reminder_count;

alter table approval_notifications add column if not exists delivery_status text not null default 'sent' check(delivery_status in ('sending','sent','failed','skipped'));
alter table approval_notifications add column if not exists attempts integer not null default 0;
alter table approval_notifications add column if not exists last_error text;
alter table approval_notifications add column if not exists updated_at timestamptz not null default now();
create index if not exists approval_notifications_retry on approval_notifications(org_id,delivery_status,updated_at);
create table if not exists approval_reminder_log (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 approval_id bigint not null,
 stage_index integer not null,
 user_id text not null,
 reminder_number integer not null,
 status text not null check(status in ('sending','sent','failed','skipped')),
 attempts integer not null default 0,
 last_error text,
 sent_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,approval_id,stage_index,user_id,reminder_number),
 foreign key(org_id,approval_id) references approval_requests(org_id,id) on delete cascade
);
create index if not exists approval_reminder_log_org_created on approval_reminder_log(org_id,created_at desc);
alter table approval_reminder_log enable row level security;
alter table approval_reminder_log force row level security;
drop policy if exists approval_reminder_log_tenant on approval_reminder_log;
create policy approval_reminder_log_tenant on approval_reminder_log using(org_id=current_setting('app.org_id',true)) with check(org_id=current_setting('app.org_id',true));
