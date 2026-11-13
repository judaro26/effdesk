-- 044_agent_interface_locale.sql
-- A nullable locale keeps the browser preference until an agent explicitly saves a language choice.
alter table agent_ticket_preferences
  add column if not exists locale text
  check (locale is null or locale in ('en','es'));
