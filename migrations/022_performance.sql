-- 022_performance.sql: indexes for the screens that run most, found by timing them on 100,000 tickets (scripts/bench.js).
create index if not exists tickets_org_updated on tickets (org_id, updated_at desc, id desc);
create index if not exists tickets_org_created on tickets (org_id, created_at desc);
create index if not exists tickets_org_solved on tickets (org_id, solved_at) where solved_at is not null;
create index if not exists tickets_org_assignee_status on tickets (org_id, assignee_id, status, updated_at desc);
create index if not exists ticket_messages_author on ticket_messages (org_id, author_id, created_at desc) where author_id is not null;
-- searching a subject, name or address by part of it (ilike '%text%') uses trigram indexes; skipped quietly where the extension cannot be installed
do $$ begin
  create extension if not exists pg_trgm;
  create index if not exists tickets_subject_trgm on tickets using gin (subject gin_trgm_ops);
  create index if not exists tickets_email_trgm on tickets using gin (requester_email gin_trgm_ops);
  create index if not exists tickets_name_trgm on tickets using gin (requester_name gin_trgm_ops);
exception when others then raise notice 'pg_trgm not available, search stays a scan: %', sqlerrm;
end $$;
