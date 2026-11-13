-- 046_change_management.sql
-- Tenant-scoped change requests, sequential approvals, service/incident links and audit history.
create table if not exists change_requests (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 title text not null check(char_length(title) between 1 and 180),
 description text not null default '' check(char_length(description)<=5000),
 change_type text not null default 'normal' check(change_type in ('standard','normal','emergency')),
 status text not null default 'draft' check(status in ('draft','submitted','assessing','awaiting_approval','approved','rejected','scheduled','implementing','completed','failed','cancelled')),
 risk text not null default 'medium' check(risk in ('low','medium','high','critical')),
 impact text not null default 'medium' check(impact in ('low','medium','high','critical')),
 planned_start timestamptz,
 planned_end timestamptz,
 implementation_plan text not null default '' check(char_length(implementation_plan)<=8000),
 test_plan text not null default '' check(char_length(test_plan)<=5000),
 rollback_plan text not null default '' check(char_length(rollback_plan)<=5000),
 outcome text not null default '' check(char_length(outcome)<=5000),
 owner_id text,
 requested_by text,
 approval_stages jsonb not null default '[]'::jsonb,
 current_stage integer not null default 0,
 approved_at timestamptz,
 completed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id),
 check(planned_start is null or planned_end is null or planned_end>planned_start)
);
create index if not exists change_requests_org_status_start on change_requests(org_id,status,planned_start);
create index if not exists change_requests_org_risk on change_requests(org_id,risk,updated_at desc);
create index if not exists change_requests_org_owner on change_requests(org_id,owner_id,status);
create table if not exists change_services (
 org_id text not null,
 change_id bigint not null,
 service_id bigint not null,
 primary key(org_id,change_id,service_id),
 foreign key(org_id,change_id) references change_requests(org_id,id) on delete cascade,
 foreign key(org_id,service_id) references business_services(org_id,id) on delete cascade
);
create table if not exists change_incidents (
 org_id text not null,
 change_id bigint not null,
 ticket_id bigint not null,
 created_at timestamptz not null default now(),
 primary key(org_id,change_id,ticket_id),
 foreign key(org_id,change_id) references change_requests(org_id,id) on delete cascade,
 foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists change_incidents_ticket on change_incidents(org_id,ticket_id,change_id);
create table if not exists change_decisions (
 id bigserial primary key,
 org_id text not null,
 change_id bigint not null,
 stage_index integer not null,
 approver_id text not null,
 decision text not null check(decision in ('approved','rejected')),
 comment text not null default '' check(char_length(comment)<=2000),
 created_at timestamptz not null default now(),
 unique(org_id,change_id,stage_index,approver_id),
 foreign key(org_id,change_id) references change_requests(org_id,id) on delete cascade
);
create index if not exists change_decisions_change on change_decisions(org_id,change_id,stage_index,created_at);
create table if not exists change_events (
 id bigserial primary key,
 org_id text not null,
 change_id bigint not null,
 actor_id text,
 actor_name text not null default '',
 event text not null check(event in ('created','updated','status_changed','approval_decided','service_linked','incident_linked')),
 detail text not null default '' check(char_length(detail)<=2000),
 created_at timestamptz not null default now(),
 foreign key(org_id,change_id) references change_requests(org_id,id) on delete cascade
);
create index if not exists change_events_change on change_events(org_id,change_id,created_at desc);
create table if not exists change_approval_notifications (
 id bigserial primary key,
 org_id text not null,
 change_id bigint not null,
 stage_index integer not null default 0,
 user_id text not null,
 event text not null check(event in ('requested','decided','completed','rejected')),
 delivery_status text not null default 'sending' check(delivery_status in ('sending','sent','failed','skipped')),
 attempts integer not null default 1,
 last_error text,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 unique(org_id,change_id,stage_index,user_id,event),
 foreign key(org_id,change_id) references change_requests(org_id,id) on delete cascade
);
create index if not exists change_approval_notifications_retry on change_approval_notifications(org_id,delivery_status,updated_at);
do $$
declare t text;
begin
 foreach t in array array['change_requests','change_services','change_incidents','change_decisions','change_events','change_approval_notifications'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
