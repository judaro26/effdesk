-- 021_roles_audit.sql: custom roles (what a team member may do) and the index the audit log search uses.
create table if not exists custom_roles (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  permissions text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (org_id, name)
);
create table if not exists member_custom_role (
  org_id text not null references "organization"(id) on delete cascade,
  user_id text not null,
  role_id bigint not null references custom_roles(id) on delete cascade,
  primary key (org_id, user_id)
);
do $$ declare t text; begin
  foreach t in array array['custom_roles','member_custom_role'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('drop policy if exists %I on %I', t || '_tenant', t);
    execute format('create policy %I on %I using (org_id = current_setting(''app.org_id'', true)) with check (org_id = current_setting(''app.org_id'', true))', t || '_tenant', t);
  end loop;
end $$;
create index if not exists audit_log_org_action on audit_log (org_id, action, at desc);
