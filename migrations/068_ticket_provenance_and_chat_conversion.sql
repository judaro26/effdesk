-- 068_ticket_provenance_and_chat_conversion.sql
alter table tickets add column if not exists source_chat_ticket_id bigint references tickets(id) on delete set null;
alter table tickets add column if not exists converted_ticket_id bigint references tickets(id) on delete set null;
create unique index if not exists tickets_source_chat_unique_idx on tickets(source_chat_ticket_id) where source_chat_ticket_id is not null;
create table if not exists ticket_provenance(ticket_id bigint primary key references tickets(id) on delete cascade,org_id text not null references "organization"(id) on delete cascade,ip_address text,identity_type text not null default 'unknown' check(identity_type in ('visitor','api','email','whatsapp','portal','agent','chat','unknown')),page_url text,page_title text,referrer text,user_agent text,submitted_at timestamptz not null default now());
create index if not exists ticket_provenance_org_submitted_idx on ticket_provenance(org_id,submitted_at desc);
alter table ticket_provenance enable row level security; alter table ticket_provenance force row level security;
drop policy if exists ticket_provenance_tenant on ticket_provenance;
create policy ticket_provenance_tenant on ticket_provenance using(org_id=current_setting('app.org_id',true)) with check(org_id=current_setting('app.org_id',true));
