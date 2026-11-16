-- 075_reconcile_duplicate_chat_backfills.sql
-- The two historical 074 backfills used different bridge columns and could
-- create a second conversation for the same legacy ticket. Keep the richer
-- legacy_ticket row as canonical, merge its bridge ids, and remove the copy.
-- Safe to re-run: all operations are keyed by tenant + source ids.

alter table chat_conversations
  add column if not exists source_ticket_id bigint references tickets(id) on delete set null;
alter table chat_messages
  add column if not exists source_message_id bigint references ticket_messages(id) on delete set null;

-- Move imported events from the source-ticket copy onto the canonical row.
update chat_events duplicate_event
set conversation_id = canonical.id
from chat_conversations duplicate_conversation
join chat_conversations canonical
  on canonical.org_id = duplicate_conversation.org_id
 and canonical.legacy_ticket_id = duplicate_conversation.source_ticket_id
where duplicate_event.org_id = duplicate_conversation.org_id
  and duplicate_event.conversation_id = duplicate_conversation.id
  and duplicate_conversation.legacy_ticket_id is null
  and duplicate_conversation.source_ticket_id is not null
  and duplicate_conversation.id <> canonical.id;

-- The canonical row already has the same transcript via legacy_ticket_message_id.
-- Remove the duplicate message copy before assigning source ids to canonical rows
-- (the source-message unique index may already exist from the other 074 migration).
delete from chat_messages duplicate_message
using chat_conversations duplicate_conversation,
      chat_conversations canonical
where duplicate_message.org_id = duplicate_conversation.org_id
  and duplicate_message.conversation_id = duplicate_conversation.id
  and canonical.org_id = duplicate_conversation.org_id
  and canonical.legacy_ticket_id = duplicate_conversation.source_ticket_id
  and duplicate_conversation.legacy_ticket_id is null
  and duplicate_conversation.source_ticket_id is not null
  and duplicate_conversation.id <> canonical.id;

delete from chat_conversations duplicate_conversation
using chat_conversations canonical
where canonical.org_id = duplicate_conversation.org_id
  and canonical.legacy_ticket_id = duplicate_conversation.source_ticket_id
  and duplicate_conversation.legacy_ticket_id is null
  and duplicate_conversation.source_ticket_id is not null
  and duplicate_conversation.id <> canonical.id;

-- Unify both bridge schemes on the canonical conversation and messages.
update chat_conversations
set source_ticket_id = legacy_ticket_id
where legacy_ticket_id is not null
  and source_ticket_id is distinct from legacy_ticket_id;

update chat_messages
set source_message_id = legacy_ticket_message_id
where legacy_ticket_message_id is not null
  and source_message_id is distinct from legacy_ticket_message_id;

create unique index if not exists chat_conversations_org_source_ticket_idx
  on chat_conversations (org_id, source_ticket_id)
  where source_ticket_id is not null;
create unique index if not exists chat_messages_org_source_message_idx
  on chat_messages (org_id, source_message_id)
  where source_message_id is not null;
