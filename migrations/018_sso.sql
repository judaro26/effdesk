-- 018_sso.sql: single sign-on (OpenID Connect) per organization. A domain can belong to one organization only.
create table if not exists sso_providers (
  org_id text primary key references "organization"(id) on delete cascade,
  enabled boolean not null default false,
  issuer text not null,
  client_id text not null,
  client_secret_enc text not null,
  domains text[] not null default '{}',
  default_role text not null default 'member' check (default_role in ('member','admin')),
  enforce boolean not null default false,
  updated_at timestamptz not null default now()
);
-- no row level security: the sign-in step has to look an organization up by the person's email domain before anyone is signed in; the secret is encrypted and only the server reads this table
create index if not exists sso_domains_idx on sso_providers using gin (domains);
