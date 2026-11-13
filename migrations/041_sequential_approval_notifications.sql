-- 041_sequential_approval_notifications.sql
-- Extend the existing tenant-scoped approval workflow with ordered stages and idempotent agent notifications.
alter table approval_requests add column if not exists stages jsonb not null default '[]'::jsonb;
alter table approval_requests add column if not exists current_stage integer not null default 0;
alter table approval_requests add column if not exists created_by text;
alter table approval_decisions add column if not exists stage_index integer not null default 0;
alter table approval_decisions drop constraint if exists approval_decisions_org_id_approval_id_approver_id_key;
create unique index if not exists approval_decisions_stage_approver_uq on approval_decisions(org_id,approval_id,stage_index,approver_id);
create table if not exists approval_notifications (
 id bigserial primary key, org_id text not null references "organization"(id) on delete cascade,
 approval_id bigint not null, stage_index integer not null default 0, user_id text not null,
 event text not null check(event in ('requested','decided','completed','rejected')),
 created_at timestamptz not null default now(),
 unique(org_id,approval_id,stage_index,user_id,event),
 foreign key(org_id,approval_id) references approval_requests(org_id,id) on delete cascade
);
create index if not exists approval_notifications_org_created on approval_notifications(org_id,created_at desc);
alter table approval_notifications enable row level security;
alter table approval_notifications force row level security;
drop policy if exists approval_notifications_tenant on approval_notifications;
create policy approval_notifications_tenant on approval_notifications using (org_id=current_setting('app.org_id',true)) with check (org_id=current_setting('app.org_id',true));
