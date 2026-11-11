-- 029_workspace_status.sql: each workspace can run its own public status page. The platform's own page has org_id null; a workspace's rows carry its id. Every query in src/status.js filters on it.
alter table status_components add column if not exists org_id text references "organization"(id) on delete cascade;
alter table status_incidents add column if not exists org_id text references "organization"(id) on delete cascade;
create index if not exists status_components_org on status_components (org_id, position);
create index if not exists status_incidents_org on status_incidents (org_id, started_at desc);
