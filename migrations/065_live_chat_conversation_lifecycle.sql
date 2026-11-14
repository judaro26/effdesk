-- 065_live_chat_conversation_lifecycle.sql
-- Keep a hashed, workspace-scoped browser identifier for safe conversation reuse.
alter table tickets add column if not exists chat_visitor_key text;
create index if not exists tickets_chat_visitor_key_updated_idx
  on tickets (org_id, chat_visitor_key, updated_at desc)
  where channel = 'chat' and chat_visitor_key is not null;

-- Workspace controls: 0 disables the respective behaviour.
alter table chat_settings add column if not exists auto_resolve_hours integer not null default 24;
alter table chat_settings add column if not exists reuse_days integer not null default 7;
