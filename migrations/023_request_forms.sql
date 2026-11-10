-- 023_request_forms.sql: request forms on the customer help center (a form sets the queue, type, labels and the extra fields a customer fills in).
create table if not exists request_forms (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  subject_hint text not null default '' check (char_length(subject_hint) <= 100),
  queue_id bigint references queues(id) on delete set null,
  type text not null default 'question',
  priority text not null default 'normal',
  tags text[] not null default '{}',
  field_keys text[] not null default '{}',
  active boolean not null default true,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
alter table request_forms enable row level security;
alter table request_forms force row level security;
drop policy if exists request_forms_tenant on request_forms;
create policy request_forms_tenant on request_forms using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
alter table tickets add column if not exists form_id bigint references request_forms(id) on delete set null;
alter table tickets add column if not exists via_portal boolean not null default false;
create index if not exists tickets_portal_recent on tickets (org_id, requester_email, created_at desc) where via_portal;
