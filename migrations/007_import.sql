-- 007_import.sql: remember where imported rows came from, so an import can be repeated without duplicating anything.
alter table tickets add column if not exists source_id text;
alter table ticket_messages add column if not exists source_id text;
alter table help_articles add column if not exists source_id text;
alter table help_articles add column if not exists source_group text;       -- the old desk's translation group, so a later import joins the same group
create unique index if not exists tickets_source on tickets (org_id, source_id) where source_id is not null;
create unique index if not exists ticket_messages_source on ticket_messages (org_id, source_id) where source_id is not null;
create unique index if not exists help_articles_source on help_articles (org_id, source_id) where source_id is not null;
