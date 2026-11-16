-- 078_live_chat_runtime_cutover.sql
-- Runtime support for independent Live Chat conversations and explicit ticket conversion.
alter table chat_settings
  add column if not exists auto_convert_to_ticket boolean not null default false;
alter table chat_conversations
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
alter table tickets
  add column if not exists source_chat_conversation_id bigint;
do $$
begin
  if not exists (select 1 from pg_constraint where conname='tickets_source_chat_conversation_fk') then
    alter table tickets add constraint tickets_source_chat_conversation_fk
      foreign key (source_chat_conversation_id) references chat_conversations(id) on delete set null;
  end if;
end $$;
create unique index if not exists tickets_source_chat_conversation_idx
  on tickets(source_chat_conversation_id) where source_chat_conversation_id is not null;
create index if not exists chat_conversations_org_updated_idx
  on chat_conversations(org_id,updated_at desc,id desc);
