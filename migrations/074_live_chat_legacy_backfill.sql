-- 074_live_chat_legacy_backfill.sql
-- Preserve existing ticket-backed chats in the dedicated conversation store.
-- The legacy link columns make this migration idempotent and allow a staged
-- runtime cutover without losing the old ticket/transcript references.

alter table chat_conversations
  add column if not exists legacy_ticket_id bigint references tickets(id) on delete set null,
  add column if not exists legacy_ticket_number integer,
  add column if not exists tags text[] not null default '{}';
create unique index if not exists chat_conversations_org_legacy_ticket_idx
  on chat_conversations (org_id, legacy_ticket_id)
  where legacy_ticket_id is not null;

alter table chat_messages
  add column if not exists legacy_ticket_message_id bigint references ticket_messages(id) on delete set null;
create unique index if not exists chat_messages_org_legacy_message_idx
  on chat_messages (org_id, legacy_ticket_message_id)
  where legacy_ticket_message_id is not null;

alter table chat_events
  add column if not exists legacy_ticket_event_id bigint references ticket_events(id) on delete set null;
create unique index if not exists chat_events_org_legacy_event_idx
  on chat_events (org_id, legacy_ticket_event_id)
  where legacy_ticket_event_id is not null;

-- The setting is intentionally opt-in. A normal chat start must not create a
-- support ticket; the runtime will honor this only after its cutover.
alter table chat_settings
  add column if not exists auto_create_ticket boolean not null default false;

do $$
declare
  tenant record;
begin
  for tenant in select id from "organization" loop
    perform set_config('app.org_id', tenant.id, true);

    insert into chat_conversations (
      org_id, subject, status, requester_name, requester_email, visitor_key,
      assignee_id, priority, tags, converted_ticket_id, last_visitor_seen_at,
      solved_at, closed_at, created_at, updated_at, legacy_ticket_id,
      legacy_ticket_number, source, page_url, page_title, referrer, user_agent, ip_address
    )
    select
      t.org_id, t.subject, t.status, t.requester_name, t.requester_email,
      t.chat_visitor_key, t.assignee_id, t.priority, t.tags, t.converted_ticket_id,
      t.chat_seen_at, t.solved_at, t.closed_at, t.created_at, t.updated_at,
      t.id, t.number, 'legacy-ticket',
      p.page_url, p.page_title, p.referrer, p.user_agent, p.ip_address
    from tickets t
    left join ticket_provenance p on p.org_id=t.org_id and p.ticket_id=t.id
    where t.org_id=tenant.id and t.channel='chat'
      and not exists (
        select 1 from chat_conversations c
        where c.org_id=t.org_id and c.legacy_ticket_id=t.id
      );

    insert into chat_messages (
      org_id, conversation_id, kind, author_id, author_name, body, html_body,
      created_at, legacy_ticket_message_id
    )
    select
      m.org_id, c.id, m.kind, m.author_id, m.author_name, m.body, m.html_body,
      m.created_at, m.id
    from ticket_messages m
    join chat_conversations c
      on c.org_id=m.org_id and c.legacy_ticket_id=m.ticket_id
    join tickets t on t.org_id=m.org_id and t.id=m.ticket_id and t.channel='chat'
    where m.org_id=tenant.id
      and not exists (
        select 1 from chat_messages cm
        where cm.org_id=m.org_id and cm.legacy_ticket_message_id=m.id
      );

    insert into chat_events (
      org_id, conversation_id, actor_name, kind, detail, created_at,
      legacy_ticket_event_id
    )
    select
      e.org_id, c.id, e.actor_name, e.kind, e.detail, e.created_at, e.id
    from ticket_events e
    join chat_conversations c
      on c.org_id=e.org_id and c.legacy_ticket_id=e.ticket_id
    join tickets t on t.org_id=e.org_id and t.id=e.ticket_id and t.channel='chat'
    where e.org_id=tenant.id
      and not exists (
        select 1 from chat_events ce
        where ce.org_id=e.org_id and ce.legacy_ticket_event_id=e.id
      );
  end loop;
end $$;
