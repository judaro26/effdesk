-- 078_live_chat_runtime_cutover.sql
-- Runtime support for independent Live Chat conversations and explicit ticket conversion.
alter table chat_settings
  add column if not exists auto_convert_to_ticket boolean not null default false;
alter table chat_conversations
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
alter table tickets
  add column if not exists source_chat_conversation_id bigint;
create unique index if not exists tickets_org_id_id_uidx on tickets(org_id,id);
do $
begin
  if not exists (select 1 from pg_constraint where conname='tickets_source_chat_conversation_fk') then
    alter table tickets add constraint tickets_source_chat_conversation_fk
      foreign key (org_id,source_chat_conversation_id) references chat_conversations(org_id,id) on delete set null;
  end if;
end $;
alter table chat_conversations drop constraint if exists chat_conversations_coordinates_valid;
alter table chat_conversations add constraint chat_conversations_coordinates_valid check ((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180));

-- Preserve the visitor-ended signal when old ticket-backed conversations were backfilled.
insert into chat_events(org_id,conversation_id,actor_name,kind,detail,created_at)
select cc.org_id,cc.id,'Website visitor','visitor_ended','Visitor ended the Live Chat conversation',te.created_at
from chat_conversations cc join ticket_events te on te.org_id=cc.org_id and te.ticket_id=cc.source_ticket_id
where cc.source_ticket_id is not null and te.kind='status' and te.detail='Visitor ended the Live Chat conversation'
  and not exists(select 1 from chat_events e where e.org_id=cc.org_id and e.conversation_id=cc.id and e.kind='visitor_ended');
create unique index if not exists tickets_source_chat_conversation_idx
  on tickets(source_chat_conversation_id) where source_chat_conversation_id is not null;
create index if not exists chat_conversations_org_updated_idx
  on chat_conversations(org_id,updated_at desc,id desc);
