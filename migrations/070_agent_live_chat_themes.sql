-- 070_agent_live_chat_themes.sql
-- Each agent's Live Chat palette is independent from their overall desk theme.
alter table desk_prefs
  add column if not exists chat_theme text not null default 'classic';
