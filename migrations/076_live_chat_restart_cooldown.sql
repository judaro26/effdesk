-- 076_live_chat_restart_cooldown.sql
-- Workspace-configurable pause after a visitor ends a conversation.
-- Zero disables the cooldown; the default is 15 seconds.
alter table chat_settings
  add column if not exists restart_cooldown_seconds integer not null default 15
  check (restart_cooldown_seconds between 0 and 3600);
