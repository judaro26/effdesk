-- 006_help.sql: the help center (articles in several languages) and the customer portal (sign-in links for requesters).
create table if not exists help_articles (
  id text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  group_id text not null,
  lang text not null check (lang in ('en','es')),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 50000),
  status text not null default 'draft' check (status in ('draft','published')),
  views integer not null default 0,
  helpful_yes integer not null default 0,
  helpful_no integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, slug, lang),
  unique (org_id, group_id, lang)
);
create index if not exists help_articles_org on help_articles (org_id, status, lang);
create table if not exists portal_links (
  token_hash text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  email text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists portal_links_recent on portal_links (org_id, email, created_at desc);
do $$ declare t text; begin
  foreach t in array array['help_articles','portal_links'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
