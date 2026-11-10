-- 026_templates_receipts.sql: WhatsApp message templates (the only thing WhatsApp lets a business send after 24 hours of silence) and email delivery receipts from Resend (delivered, delayed, bounced, spam complaint).
create table if not exists whatsapp_templates (
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check (name ~ '^[a-z0-9_]{1,100}$'),
  language text not null default 'en_US',
  body text not null,
  updated_at timestamptz not null default now(),
  primary key (org_id, name, language)
);
alter table whatsapp_templates enable row level security;
alter table whatsapp_templates force row level security;
drop policy if exists whatsapp_templates_tenant on whatsapp_templates;
create policy whatsapp_templates_tenant on whatsapp_templates using (org_id = current_setting('app.org_id', true)) with check (org_id = current_setting('app.org_id', true));
alter table ticket_messages add column if not exists delivery_status text;
alter table ticket_messages add column if not exists delivery_error text;
-- Resend tells us about an email by ITS id and we do not know the workspace yet, so this lookup is not row-level secured (it holds no content)
create table if not exists email_receipts (
  provider_id text primary key,
  org_id text not null references "organization"(id) on delete cascade,
  message_id bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists email_receipts_age on email_receipts (created_at);
