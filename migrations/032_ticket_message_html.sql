-- Preserve sanitized HTML from inbound email separately from the plain-text message body.
alter table ticket_messages add column if not exists html_body text;
