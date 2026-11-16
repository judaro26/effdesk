-- 080_live_chat_attachments.sql
-- Extend the existing object-storage index with links to the independent Live Chat model.
-- Ticket attachment columns remain unchanged; a chat file can never be claimed by a ticket reply.
create unique index if not exists chat_messages_org_id_uidx on chat_messages(org_id,id);

alter table attachments
  add column if not exists chat_conversation_id bigint,
  add column if not exists chat_message_id bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='attachments_chat_conversation_fk') then
    alter table attachments add constraint attachments_chat_conversation_fk
      foreign key (org_id,chat_conversation_id)
      references chat_conversations(org_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='attachments_chat_message_fk') then
    alter table attachments add constraint attachments_chat_message_fk
      foreign key (org_id,chat_message_id)
      references chat_messages(org_id,id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname='attachments_chat_message_requires_conversation') then
    alter table attachments add constraint attachments_chat_message_requires_conversation
      check (chat_message_id is null or chat_conversation_id is not null);
  end if;
end $$;

create index if not exists attachments_chat_conversation
  on attachments(org_id,chat_conversation_id,created_at)
  where chat_conversation_id is not null;
create index if not exists attachments_chat_message
  on attachments(org_id,chat_message_id)
  where chat_message_id is not null;
