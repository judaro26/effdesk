-- 010_prefs.sql: a person's own desk settings (so far the theme). One row per user, not per organization, so it follows them everywhere.
create table if not exists desk_prefs (
  user_id text primary key,
  theme text not null default 'classic' check (char_length(theme) between 1 and 30),
  updated_at timestamptz not null default now()
);
