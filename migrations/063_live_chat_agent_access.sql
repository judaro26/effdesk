-- Per-agent Live Chat access and opt-in availability.
-- Existing agents start disabled/offline until an administrator explicitly enables access.
alter table agent_status
  add column if not exists chat_access boolean not null default false,
  add column if not exists chat_available boolean not null default false;
