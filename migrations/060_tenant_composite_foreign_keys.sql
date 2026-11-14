-- 060_tenant_composite_foreign_keys.sql
-- Enforce tenant ownership across ticket/message/file relationships at the database boundary.
-- Application queries and RLS already scope these records; these composite foreign keys
-- prevent an incorrectly scoped insert from linking rows across organizations.

do $$
begin
  if exists (
    select 1 from ticket_messages m
    join tickets t on t.id = m.ticket_id
    where m.org_id <> t.org_id
  ) then
    raise exception 'Cannot add tenant-safe ticket message foreign key: cross-tenant message references already exist';
  end if;
  if exists (
    select 1 from attachments a
    join tickets t on t.id = a.ticket_id
    where a.org_id <> t.org_id
  ) then
    raise exception 'Cannot add tenant-safe attachment ticket foreign key: cross-tenant references already exist';
  end if;
  if exists (
    select 1 from attachments a
    join ticket_messages m on m.id = a.message_id
    where a.org_id <> m.org_id
  ) then
    raise exception 'Cannot add tenant-safe attachment message foreign key: cross-tenant references already exist';
  end if;
end $$;

create unique index if not exists tickets_org_id_id_unique on tickets (org_id, id);
create unique index if not exists ticket_messages_org_id_id_unique on ticket_messages (org_id, id);

alter table ticket_messages drop constraint if exists ticket_messages_ticket_id_fkey;
alter table ticket_messages
  add constraint ticket_messages_org_ticket_fk
  foreign key (org_id, ticket_id) references tickets (org_id, id) on delete cascade;

alter table attachments drop constraint if exists attachments_ticket_id_fkey;
alter table attachments drop constraint if exists attachments_message_id_fkey;
alter table attachments
  add constraint attachments_org_ticket_fk
  foreign key (org_id, ticket_id) references tickets (org_id, id) on delete cascade;
alter table attachments
  add constraint attachments_org_message_fk
  foreign key (org_id, message_id) references ticket_messages (org_id, id) on delete cascade;
