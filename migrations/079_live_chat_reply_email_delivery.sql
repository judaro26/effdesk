-- 079_live_chat_reply_email_delivery.sql
-- Track delivery state for offline visitor follow-ups without mixing them into ticket messages.
alter table chat_messages
  add column if not exists delivery text
  check (delivery is null or delivery in ('queued','sent','failed','skipped'));

create index if not exists chat_messages_org_email_delivery_idx
  on chat_messages (org_id, delivery, created_at)
  where kind='agent' and delivery in ('queued','failed');
