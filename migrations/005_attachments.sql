-- 005_attachments.sql: files on tickets. The bytes live in object storage (Netlify Blobs, key = org_id/id); this table is the index. message_id is null while an agent's upload waits for its reply.
create table if not exists attachments (
  id text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint references tickets(id) on delete cascade,
  message_id bigint references ticket_messages(id) on delete cascade,
  filename text not null check (char_length(filename) between 1 and 200),
  content_type text not null default 'application/octet-stream',
  size integer not null check (size >= 0),
  uploaded_by text,
  created_at timestamptz not null default now()
);
create index if not exists attachments_ticket on attachments (org_id, ticket_id);
create index if not exists attachments_message on attachments (message_id);
alter table attachments enable row level security;
alter table attachments force row level security;
drop policy if exists attachments_tenant on attachments;
create policy attachments_tenant on attachments using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
