-- 012_avatar_webhooks.sql: a profile picture per agent (a small image stored as text), and outbound webhooks per organization.
alter table desk_prefs add column if not exists avatar text;
create table if not exists webhooks (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  url text not null,
  secret text not null,
  events text[] not null default '{}',
  active boolean not null default true,
  last_status text,
  last_at timestamptz,
  created_at timestamptz not null default now()
);
alter table webhooks enable row level security;
alter table webhooks force row level security;
drop policy if exists webhooks_tenant on webhooks;
create policy webhooks_tenant on webhooks using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
