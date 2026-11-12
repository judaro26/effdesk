-- 033_saved_view_columns.sql: let each saved view remember its ticket table layout.
alter table saved_views add column if not exists columns jsonb not null default '["status","number","subject","requester","priority","assignee","updated"]'::jsonb;
