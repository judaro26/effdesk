-- 040_service_request_approvals.sql
-- Approval workflows extend existing request forms; no parallel catalog is introduced.
alter table request_forms add column if not exists approval_config jsonb not null default '{"enabled":false,"mode":"all","approverIds":[],"tasks":[]}'::jsonb;
create unique index if not exists tickets_org_id_id_uq on tickets(org_id,id);
create unique index if not exists request_forms_org_id_id_uq on request_forms(org_id,id);
create table if not exists approval_requests (
 id bigserial primary key, org_id text not null references "organization"(id) on delete cascade,
 ticket_id bigint not null, ticket_number bigint not null,
 form_id bigint references request_forms(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 mode text not null default 'all' check(mode in ('all','any')), approver_ids text[] not null default '{}',
 title text not null default 'Request approval', created_at timestamptz not null default now(), decided_at timestamptz,
 unique(org_id,ticket_id), unique(org_id,id),
 foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists approval_requests_inbox on approval_requests(org_id,status,created_at desc);
create table if not exists approval_decisions (
 id bigserial primary key, org_id text not null references "organization"(id) on delete cascade,
 approval_id bigint not null, approver_id text not null,
 decision text not null check(decision in ('approved','rejected')), comment text not null default '',
 created_at timestamptz not null default now(), unique(org_id,approval_id,approver_id),
 foreign key(org_id,approval_id) references approval_requests(org_id,id) on delete cascade
);
create table if not exists fulfillment_tasks (
 id bigserial primary key, org_id text not null references "organization"(id) on delete cascade,
 ticket_id bigint not null, approval_id bigint,
 title text not null, description text not null default '', assignee_id text,
 status text not null default 'open' check(status in ('open','in_progress','done','cancelled')),
 position integer not null default 0, created_by text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(char_length(title) between 1 and 160), check(char_length(description)<=3000),
 foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade,
 foreign key(org_id,approval_id) references approval_requests(org_id,id) on delete cascade
);
create index if not exists fulfillment_tasks_ticket on fulfillment_tasks(org_id,ticket_id,position,id);
create index if not exists fulfillment_tasks_assignee on fulfillment_tasks(org_id,assignee_id,status);
do $$
declare t text;
begin
 foreach t in array array['approval_requests','approval_decisions','fulfillment_tasks'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
