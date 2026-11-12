-- 034_on_hold_and_inline_attachments.sql
-- On-hold is an unresolved, active ticket state. It can also be used as the
-- category for workspace-defined statuses.
alter table tickets drop constraint if exists tickets_status_check;
alter table tickets add constraint tickets_status_check
  check (status in ('open','pending','on_hold','solved','closed'));

alter table ticket_statuses drop constraint if exists ticket_statuses_category_check;
alter table ticket_statuses add constraint ticket_statuses_category_check
  check (category in ('open','pending','on_hold','solved','closed'));

-- Inline images are served in the message body, not listed as downloadable attachments.
alter table attachments add column if not exists is_inline boolean not null default false;
create index if not exists attachments_message_visible
  on attachments (org_id, message_id, created_at) where is_inline = false;
