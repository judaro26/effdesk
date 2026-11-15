-- 069_live_chat_agent_presence_and_handoff.sql
-- A browser heartbeat expires abandoned "accepting chats" sessions and prevents
-- closed tabs from continuing to receive newly routed conversations.
alter table agent_status add column if not exists chat_last_seen_at timestamptz;
create index if not exists agent_status_chat_presence
  on agent_status (org_id, chat_available, chat_last_seen_at desc)
  where chat_access = true;
