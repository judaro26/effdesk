-- 002_core.sql: billing, licences, webhook de-duplication and the audit log. Every table about an organization carries org_id.
-- Row level security (FORCE, so it applies to the table owner too) keeps tenant data apart even if a query forgets its WHERE: the app sets app.org_id for each request (src/db.js withOrg).
create table if not exists subscriptions (
  org_id text primary key references "organization"(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','team','suite','pro')),
  interval text check (interval in ('month','year')),
  seats_paid integer not null default 0 check (seats_paid >= 0),
  status text not null default 'none',
  paddle_customer_id text,
  paddle_subscription_id text unique,
  current_period_end timestamptz,
  paddle_event_at timestamptz,
  license text check (license in ('lifetime_unlimited')),
  license_note text,
  license_granted_by text,
  license_granted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists webhook_events (
  id text primary key,
  provider text not null,
  type text not null,
  received_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  actor_id text,
  action text not null,
  target text,
  meta jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index if not exists audit_log_org_at on audit_log (org_id, at desc);
alter table audit_log enable row level security;
alter table audit_log force row level security;
drop policy if exists audit_log_tenant on audit_log;
create policy audit_log_tenant on audit_log using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
