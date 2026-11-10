-- 025_whatsapp.sql: WhatsApp as a channel. A customer's WhatsApp message becomes (or joins) a ticket with the channel "whatsapp"; agents reply from the desk. The account row is looked up by the number's ID when Meta calls the webhook (no tenant is known yet), so like SSO it is not row-level secured; the token and app secret are stored encrypted.
alter table tickets drop constraint if exists tickets_channel_check;
alter table tickets add constraint tickets_channel_check check (channel in ('web','email','api','chat','whatsapp'));
alter table tickets add column if not exists requester_phone text;
create index if not exists tickets_phone_idx on tickets (org_id, requester_phone) where requester_phone is not null;
create table if not exists whatsapp_accounts (
  org_id text primary key references "organization"(id) on delete cascade,
  enabled boolean not null default false,
  phone_number_id text not null,
  display_phone text not null default '',
  access_token_enc text not null,
  app_secret_enc text not null,
  verify_token text not null,
  updated_at timestamptz not null default now()
);
create unique index if not exists whatsapp_number_idx on whatsapp_accounts (phone_number_id);
-- what was sent or received: the WhatsApp message id (to ignore repeats and to attach delivery reports) and the delivery state of agent messages
create table if not exists whatsapp_messages (
  org_id text not null references "organization"(id) on delete cascade,
  wamid text not null,
  ticket_id bigint,
  message_id bigint,
  direction text not null check (direction in ('in','out')),
  status text not null default 'received',
  error text,
  updated_at timestamptz not null default now(),
  primary key (org_id, wamid)
);
alter table whatsapp_messages enable row level security;
alter table whatsapp_messages force row level security;
drop policy if exists whatsapp_messages_tenant on whatsapp_messages;
create policy whatsapp_messages_tenant on whatsapp_messages using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
