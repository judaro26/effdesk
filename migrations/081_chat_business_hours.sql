-- 081_chat_business_hours.sql
-- Workspace-local Live Chat availability, holiday closures and after-hours behavior.
alter table chat_settings
  add column if not exists availability_enabled boolean not null default false,
  add column if not exists availability_timezone text not null default 'America/Los_Angeles',
  add column if not exists weekly_hours jsonb not null default '{"mon":{"enabled":true,"start":"09:00","end":"17:00"},"tue":{"enabled":true,"start":"09:00","end":"17:00"},"wed":{"enabled":true,"start":"09:00","end":"17:00"},"thu":{"enabled":true,"start":"09:00","end":"17:00"},"fri":{"enabled":true,"start":"09:00","end":"17:00"},"sat":{"enabled":false,"start":"09:00","end":"17:00"},"sun":{"enabled":false,"start":"09:00","end":"17:00"}}'::jsonb,
  add column if not exists availability_holidays jsonb not null default '[]'::jsonb,
  add column if not exists after_hours_mode text not null default 'contact_form',
  add column if not exists after_hours_message text not null default 'We are currently closed. Leave a message and our team will get back to you.';
alter table chat_settings drop constraint if exists chat_settings_after_hours_mode_check;
alter table chat_settings add constraint chat_settings_after_hours_mode_check check (after_hours_mode in ('contact_form','hide'));
