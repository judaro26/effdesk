-- 017_live_chat.sql: live chat. A chat is a ticket with the channel "chat"; the settings say whether the widget is on and how it looks.
alter table tickets drop constraint if exists tickets_channel_check;
alter table tickets add constraint tickets_channel_check check (channel in ('web','email','api','chat'));
alter table tickets add column if not exists chat_seen_at timestamptz;
create table if not exists chat_settings (
  org_id text primary key references "organization"(id) on delete cascade,
  enabled boolean not null default false,
  title text not null default 'Chat with us',
  greeting text not null default 'Hi! Ask us anything. We reply here, and by email if you leave.',
  color text not null default '#1f73b7',
  updated_at timestamptz not null default now()
);
alter table chat_settings enable row level security;
alter table chat_settings force row level security;
drop policy if exists chat_settings_tenant on chat_settings;
create policy chat_settings_tenant on chat_settings using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
