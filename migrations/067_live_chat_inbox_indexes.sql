-- Keep active chat inbox paging and latest-public-message lookups index-backed as workspaces grow.
create index if not exists tickets_live_chat_inbox_idx
  on tickets (org_id, status, assignee_id, created_at, updated_at desc, id desc)
  where channel = 'chat' and status in ('open','pending','on_hold');

create index if not exists ticket_messages_chat_latest_idx
  on ticket_messages (org_id, ticket_id, created_at desc, id desc)
  where kind in ('requester','agent');
