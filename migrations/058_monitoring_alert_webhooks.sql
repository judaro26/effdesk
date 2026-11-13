-- 058_monitoring_alert_webhooks.sql
-- The hash-only token registry is intentionally global so a webhook token can resolve
-- its tenant before RLS context is established. It contains no plaintext secrets and is
-- accessed only by server-side webhook handlers; all operational metadata is forced-RLS.
-- Tenant-owned inbound monitoring alert endpoints and deduplicated alert-to-ticket links.
create table if not exists monitoring_alert_connections (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check(provider in ('datadog','grafana','splunk','sentry')),
  name text not null check(char_length(name) between 1 and 100),
  active boolean not null default true,
  last_status text,
  last_at timestamptz,
  last_error text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,id)
);
create unique index if not exists monitoring_alert_one_active
  on monitoring_alert_connections(org_id,provider) where active=true;
create table if not exists monitoring_alert_token_registry (
  token_hash text primary key check(char_length(token_hash)=64),
  org_id text not null references "organization"(id) on delete cascade,
  connection_id bigint not null,
  provider text not null check(provider in ('datadog','grafana','splunk','sentry')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(org_id,connection_id) references monitoring_alert_connections(org_id,id) on delete cascade
);
create index if not exists monitoring_alert_token_lookup on monitoring_alert_token_registry(provider,active);
create table if not exists monitoring_alert_links (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check(provider in ('datadog','grafana','splunk','sentry')),
  external_alert_key text not null,
  ticket_id bigint not null,
  external_url text,
  external_status text,
  external_severity text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(org_id,provider,external_alert_key),
  foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists monitoring_alert_links_ticket on monitoring_alert_links(org_id,ticket_id);
create table if not exists monitoring_alert_events (
  org_id text not null references "organization"(id) on delete cascade,
  provider text not null check(provider in ('datadog','grafana','splunk','sentry')),
  event_id text not null,
  external_alert_key text not null,
  received_at timestamptz not null default now(),
  primary key(org_id,provider,event_id)
);
do $$
declare t text;
begin
 foreach t in array array['monitoring_alert_connections','monitoring_alert_links','monitoring_alert_events'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
