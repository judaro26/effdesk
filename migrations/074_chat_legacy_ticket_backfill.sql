-- 074_chat_legacy_ticket_backfill.sql
-- Preserve existing ticket-backed Live Chat conversations in the dedicated store
-- before the runtime cutover. This is a non-destructive copy: legacy tickets and
-- their messages remain untouched for compatibility and rollback.

alter table chat_conversations
  add column if not exists source_ticket_id bigint references tickets(id) on delete set null;
create unique index if not exists chat_conversations_org_source_ticket_idx
  on chat_conversations (org_id, source_ticket_id)
  where source_ticket_id is not null;

alter table chat_messages
  add column if not exists source_message_id bigint references ticket_messages(id) on delete set null;
create unique index if not exists chat_messages_org_source_message_idx
  on chat_messages (org_id, source_message_id)
  where source_message_id is not null;

-- Keep the legacy ticket id as an explicit bridge. The tenant id is included in
-- every join and conflict key so one workspace can never attach another's rows.
insert into chat_conversations (
  org_id, source_ticket_id, subject, status, requester_name, requester_email,
  visitor_key, assignee_id, priority, page_url, page_title, referrer,
  user_agent, ip_address, source, converted_ticket_id, last_visitor_seen_at,
  solved_at, closed_at, created_at, updated_at
)
select
  t.org_id, t.id, t.subject, t.status, t.requester_name, t.requester_email,
  t.chat_visitor_key, t.assignee_id, t.priority, p.page_url, p.page_title,
  p.referrer, p.user_agent, p.ip_address, 'legacy_ticket',
  t.converted_ticket_id, t.chat_seen_at, t.solved_at, t.closed_at,
  t.created_at, t.updated_at
from tickets t
left join ticket_provenance p
  on p.org_id = t.org_id and p.ticket_id = t.id
where t.channel = 'chat'
on conflict (org_id, source_ticket_id) where source_ticket_id is not null
do nothing;

-- Copy public and private transcript entries without rewriting timestamps,
-- authors, kinds, or HTML bodies. Source ids make retries safe.
insert into chat_messages (
  org_id, conversation_id, source_message_id, kind, author_id,
  author_name, body, html_body, created_at
)
select
  tm.org_id, cc.id, tm.id, tm.kind, tm.author_id,
  tm.author_name, tm.body, tm.html_body, tm.created_at
from ticket_messages tm
join tickets t on t.org_id = tm.org_id and t.id = tm.ticket_id
join chat_conversations cc
  on cc.org_id = t.org_id and cc.source_ticket_id = t.id
where t.channel = 'chat'
on conflict (org_id, source_message_id) where source_message_id is not null
do nothing;

-- Mark the import in the conversation event stream for supervisor visibility.
insert into chat_events (org_id, conversation_id, actor_name, kind, detail, created_at)
select cc.org_id, cc.id, 'EffDesk migration', 'legacy_import',
  'Imported from legacy Live Chat ticket #' || t.number,
  t.created_at
from chat_conversations cc
join tickets t on t.org_id = cc.org_id and t.id = cc.source_ticket_id
where cc.source_ticket_id is not null
  and not exists (
    select 1 from chat_events e
    where e.org_id = cc.org_id and e.conversation_id = cc.id
      and e.kind = 'legacy_import'
  );
