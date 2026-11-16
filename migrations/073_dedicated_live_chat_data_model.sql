-- 073_dedicated_live_chat_data_model.sql
-- Establish a tenant-scoped conversation store independent of support tickets.
-- Runtime cutover is deliberately handled in a follow-up change so existing
-- widget and agent clients keep working until all chat endpoints are migrated.

create table if not exists chat_conversations (
  id bigint generated always as identity primary key,
  org_id text not null references "organization"(id) on delete cascade,
  subject text not null default 'Live Chat',
  status text not null default 'open'
    check (status in ('open','pending','on_hold','solved','closed')),
  requester_name text not null default '',
  requester_email text not null,
  visitor_key text,
  visitor_token_hash text,
  assignee_id text,
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  page_url text,
  page_title text,
  referrer text,
  user_agent text,
  ip_address text,
  source text not null default 'widget',
  converted_ticket_id bigint references tickets(id) on delete set null,
  last_visitor_seen_at timestamptz,
  solved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, id)
);

create unique index if not exists chat_conversations_org_token_idx
  on chat_conversations (org_id, visitor_token_hash)
  where visitor_token_hash is not null;
create index if not exists chat_conversations_org_queue_idx
  on chat_conversations (org_id, status, assignee_id, created_at, id);
create index if not exists chat_conversations_org_requester_idx
  on chat_conversations (org_id, lower(requester_email), updated_at desc);
create index if not exists chat_conversations_org_visitor_reuse_idx
  on chat_conversations (org_id, visitor_key, lower(requester_email), updated_at desc)
  where visitor_key is not null;
create index if not exists chat_conversations_org_assignee_idx
  on chat_conversations (org_id, assignee_id, status, updated_at desc);

create table if not exists chat_messages (
  id bigint generated always as identity primary key,
  org_id text not null references "organization"(id) on delete cascade,
  conversation_id bigint not null,
  kind text not null check (kind in ('requester','agent','note','system')),
  author_id text,
  author_name text not null default '',
  body text not null default '',
  html_body text,
  created_at timestamptz not null default now(),
  foreign key (org_id, conversation_id)
    references chat_conversations(org_id, id) on delete cascade
);
create index if not exists chat_messages_org_conversation_idx
  on chat_messages (org_id, conversation_id, created_at, id);

create table if not exists chat_events (
  id bigint generated always as identity primary key,
  org_id text not null references "organization"(id) on delete cascade,
  conversation_id bigint not null,
  actor_id text,
  actor_name text not null default '',
  kind text not null,
  detail text not null default '',
  created_at timestamptz not null default now(),
  foreign key (org_id, conversation_id)
    references chat_conversations(org_id, id) on delete cascade
);
create index if not exists chat_events_org_conversation_idx
  on chat_events (org_id, conversation_id, created_at, id);

alter table chat_conversations enable row level security;
alter table chat_conversations force row level security;
drop policy if exists chat_conversations_tenant on chat_conversations;
create policy chat_conversations_tenant on chat_conversations
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

alter table chat_messages enable row level security;
alter table chat_messages force row level security;
drop policy if exists chat_messages_tenant on chat_messages;
create policy chat_messages_tenant on chat_messages
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));

alter table chat_events enable row level security;
alter table chat_events force row level security;
drop policy if exists chat_events_tenant on chat_events;
create policy chat_events_tenant on chat_events
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
