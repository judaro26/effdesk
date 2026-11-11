-- 027_platform_admin.sql: the platform owner's tools. None of these tables hold customers' ticket content, and none is tenant-scoped (they are the platform's own), so no row-level security: only the platform admin API and the public status page read or write them.
-- Errors: one row per kind of failure with a count, so a failure that happens 500 times is one line and one email.
create table if not exists error_events (
  id bigserial primary key,
  fingerprint text not null unique,
  source text not null default 'server' check (source in ('server','browser')),
  fn text not null default '',
  name text not null default '',
  message text not null default '',
  stack text not null default '',
  path text not null default '',
  status integer,
  request_id text,
  deploy text,
  org_id text,
  count integer not null default 1,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  last_alerted_at timestamptz
);
create index if not exists error_events_last on error_events (last_seen desc);
-- Status page: components, incidents (and planned maintenance) with their updates.
create table if not exists status_components (
  id serial primary key,
  name text not null,
  description text not null default '',
  position integer not null default 0,
  status text not null default 'operational' check (status in ('operational','degraded','partial_outage','major_outage','maintenance')),
  auto_check text check (auto_check is null or auto_check in ('database')),
  visible boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists status_incidents (
  id serial primary key,
  kind text not null default 'incident' check (kind in ('incident','maintenance')),
  title text not null,
  status text not null default 'investigating' check (status in ('investigating','identified','monitoring','resolved','scheduled','in_progress','completed')),
  impact text not null default 'minor' check (impact in ('none','minor','major','critical')),
  component_ids integer[] not null default '{}',
  started_at timestamptz not null default now(),
  resolved_at timestamptz,
  scheduled_for timestamptz,
  scheduled_until timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists status_incidents_started on status_incidents (started_at desc);
create table if not exists status_updates (
  id serial primary key,
  incident_id integer not null references status_incidents(id) on delete cascade,
  status text not null,
  body text not null,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists status_updates_incident on status_updates (incident_id, created_at);
insert into status_components (name, description, position, auto_check) select 'Help desk and agent app', 'Signing in, tickets, replies and the desk', 1, 'database' where not exists (select 1 from status_components);
insert into status_components (name, description, position) select 'Email sending and receiving', 'Replies to customers and tickets created by email', 2 where (select count(*) from status_components) = 1;
insert into status_components (name, description, position) select 'Customer portal and help center', 'The public help center, request forms and portal sign-in', 3 where (select count(*) from status_components) = 2;
insert into status_components (name, description, position) select 'WhatsApp and live chat', 'Messages from WhatsApp and the chat button', 4 where (select count(*) from status_components) = 3;
insert into status_components (name, description, position) select 'API and webhooks', 'The REST API and outgoing webhooks', 5 where (select count(*) from status_components) = 4;
-- Platform settings (one row per key): the announcement banner, whether signups are open.
create table if not exists platform_settings (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by text
);
-- Per-customer settings the owner can change for support: limits above the plan's, features switched on or off, a suspension and a private note.
create table if not exists org_overrides (
  org_id text primary key references "organization"(id) on delete cascade,
  seat_limit integer check (seat_limit is null or seat_limit between 1 and 100000),
  mail_per_day integer check (mail_per_day is null or mail_per_day between 1 and 1000000),
  storage_mb integer check (storage_mb is null or storage_mb between 1 and 10000000),
  ai_monthly integer check (ai_monthly is null or ai_monthly between 0 and 10000000),
  features_on text[] not null default '{}',
  features_off text[] not null default '{}',
  suspended boolean not null default false,
  suspended_reason text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now(),
  updated_by text
);
-- What the platform owner did, and to whom.
create table if not exists platform_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'
);
create index if not exists platform_audit_at on platform_audit (at desc);
