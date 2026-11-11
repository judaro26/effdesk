-- 030_help_rich.sql: richer help articles (HTML body, categories, a plain-text copy for search and excerpts), images used in articles, and each workspace's help-center look.
alter table help_articles add column if not exists format text not null default 'text' check (format in ('text','html'));
alter table help_articles add column if not exists category text not null default '' check (char_length(category) <= 60);
alter table help_articles add column if not exists plain text;
create table if not exists help_images (
  id text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  content_type text not null check (content_type in ('image/png','image/jpeg','image/gif','image/webp')),
  size integer not null,
  created_at timestamptz not null default now()
);
create index if not exists help_images_org on help_images (org_id);
create table if not exists help_settings (
  org_id text primary key references "organization"(id) on delete cascade,
  theme text not null default 'classic',
  accent text not null default '' check (accent = '' or accent ~ '^#[0-9a-fA-F]{6}$'),
  hero_title text not null default '' check (char_length(hero_title) <= 100),
  hero_subtitle text not null default '' check (char_length(hero_subtitle) <= 200),
  updated_at timestamptz not null default now()
);
do $$ declare t text; begin
  foreach t in array array['help_images','help_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
