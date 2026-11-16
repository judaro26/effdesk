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
do $$
begin
  if not exists (select 1 from pg_constraint where conname='tickets_source_chat_conversation_fk') then
    alter table tickets add constraint tickets_source_chat_conversation_fk
      foreign key (org_id,source_chat_conversation_id) references chat_conversations(org_id,id) on delete restrict;
  end if;
end $$;
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

alter table chat_messages add column if not exists idempotency_key text;
create unique index if not exists chat_messages_org_idempotency_idx
  on chat_messages(org_id,conversation_id,author_id,idempotency_key)
  where idempotency_key is not null;

-- Keep chat identifiers in a separate numeric namespace from support ticket numbers.
create sequence if not exists chat_conversation_number_seq start with 1000000001;
alter table chat_conversations add column if not exists chat_number bigint;
update chat_conversations set chat_number=1000000000+id where chat_number is null;
alter table chat_conversations alter column chat_number set default nextval('chat_conversation_number_seq');
alter table chat_conversations alter column chat_number set not null;
create unique index if not exists chat_conversations_org_chat_number_idx
  on chat_conversations(org_id,chat_number);

select setval('chat_conversation_number_seq', greatest(1000000001, coalesce((select max(chat_number) from chat_conversations),1000000000)+1), false);

-- Preserve any previously collected, visitor-consented coordinates during backfill.
update chat_conversations cc
set latitude=p.latitude,longitude=p.longitude
from ticket_provenance p
where p.org_id=cc.org_id and p.ticket_id=cc.source_ticket_id
  and cc.source_ticket_id is not null
  and cc.latitude is null and cc.longitude is null
  and p.latitude is not null and p.longitude is not null;

create table if not exists chat_presence (
  org_id text not null references "organization"(id) on delete cascade,
  conversation_id bigint not null,
  user_id text not null,
  name text not null default '',
  typing boolean not null default false,
  seen_at timestamptz not null default now(),
  primary key(org_id,conversation_id,user_id),
  foreign key(org_id,conversation_id) references chat_conversations(org_id,id) on delete cascade
);
create index if not exists chat_presence_fresh_idx on chat_presence(org_id,conversation_id,seen_at desc);
alter table chat_presence enable row level security;
drop policy if exists tenant_isolation on chat_presence;
create policy tenant_isolation on chat_presence using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
