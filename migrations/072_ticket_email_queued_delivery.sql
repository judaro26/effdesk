-- 072_ticket_email_queued_delivery.sql
-- Public ticket replies can now wait in the durable background job outbox.
alter table ticket_messages drop constraint if exists ticket_messages_delivery_check;
alter table ticket_messages add constraint ticket_messages_delivery_check
  check (delivery is null or delivery in ('queued','sent','failed','skipped'));
