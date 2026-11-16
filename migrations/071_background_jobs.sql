-- 071_background_jobs.sql
-- Tenant-scoped durable outbox for retryable asynchronous work.
create table if not exists background_jobs (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  job_type text not null check (length(job_type) between 1 and 100),
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 20),
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, job_type, idempotency_key),
  check ((status = 'running') = (locked_at is not null and locked_by is not null))
);
create index if not exists background_jobs_due on background_jobs(org_id, run_at, id) where status = 'queued';
create index if not exists background_jobs_lease on background_jobs(org_id, locked_at, id) where status = 'running';
alter table background_jobs enable row level security;
alter table background_jobs force row level security;
drop policy if exists background_jobs_tenant on background_jobs;
create policy background_jobs_tenant on background_jobs
  using (org_id = current_setting('app.org_id', true))
  with check (org_id = current_setting('app.org_id', true));
