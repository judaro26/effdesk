-- Keep active chat inbox paging and latest-public-message lookups index-backed as workspaces grow.
-- Prefix-search indexes keep requester, assigned-agent and contact lookups bounded as directories grow.
create index if not exists tickets_live_chat_subject_search_idx
  on tickets (org_id, lower(subject) text_pattern_ops)
  where channel = 'chat' and status in ('open','pending','on_hold');

create index if not exists tickets_live_chat_requester_name_search_idx
  on tickets (org_id, lower(requester_name) text_pattern_ops)
  where channel = 'chat' and status in ('open','pending','on_hold');

create index if not exists tickets_live_chat_requester_email_search_idx
  on tickets (org_id, lower(requester_email) text_pattern_ops)
  where channel = 'chat' and status in ('open','pending','on_hold');

create index if not exists contact_profiles_org_name_search_idx
  on contact_profiles (org_id, lower(name) text_pattern_ops);

create index if not exists contact_profiles_org_email_search_idx
  on contact_profiles (org_id, lower(email) text_pattern_ops);

create index if not exists clients_org_name_search_idx
  on clients (org_id, lower(name) text_pattern_ops);

create index if not exists user_name_search_idx
  on "user" (lower(name) text_pattern_ops);

create index if not exists user_email_search_idx
  on "user" (lower(email) text_pattern_ops);

create index if not exists tickets_live_chat_inbox_idx
  on tickets (org_id, status, assignee_id, created_at, updated_at desc, id desc)
  where channel = 'chat' and status in ('open','pending','on_hold');

create index if not exists tickets_live_chat_waiting_idx
  on tickets (org_id, created_at, id)
  where channel = 'chat' and status in ('open','pending','on_hold') and assignee_id is null;

create index if not exists tickets_live_chat_assigned_idx
  on tickets (org_id, updated_at desc, id desc)
  where channel = 'chat' and status in ('open','pending','on_hold') and assignee_id is not null;

create index if not exists ticket_messages_chat_requester_cursor_idx
  on ticket_messages (org_id, id)
  where kind = 'requester';

create index if not exists ticket_messages_chat_latest_idx
  on ticket_messages (org_id, ticket_id, created_at desc, id desc)
  where kind in ('requester','agent');
