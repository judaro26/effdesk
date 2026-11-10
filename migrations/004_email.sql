-- 004_email.sql: email in and out. inbox_directory maps an inbound address (the part before @) to its organization; it has no row level security because the inbound webhook must find the organization BEFORE it can say which one it is working for, and it holds nothing but that mapping.
create table if not exists inbox_directory (
  inbox text primary key check (inbox ~ '^[a-z0-9][a-z0-9-]{2,31}$'),
  org_id text not null unique references "organization"(id) on delete cascade
);
create table if not exists mail_settings (
  org_id text primary key references "organization"(id) on delete cascade,
  reply_mode text not null default 'ticket' check (reply_mode in ('ticket','custom','none')),
  reply_to text check (reply_to is null or char_length(reply_to) <= 254),
  from_name text not null default '' check (char_length(from_name) <= 100),
  signature text not null default '' check (char_length(signature) <= 1000),
  updated_at timestamptz not null default now()
);
alter table mail_settings enable row level security;
alter table mail_settings force row level security;
drop policy if exists mail_settings_tenant on mail_settings;
create policy mail_settings_tenant on mail_settings using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
alter table ticket_messages add column if not exists message_id text;
alter table ticket_messages add column if not exists delivery text check (delivery in ('sent','failed','skipped'));
create unique index if not exists ticket_messages_msgid on ticket_messages (org_id, message_id) where message_id is not null;
