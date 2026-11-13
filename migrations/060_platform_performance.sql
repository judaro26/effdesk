-- Sampled, minute-level performance aggregates. No request bodies, query strings, emails or user identifiers are stored.
create table if not exists performance_minute (
  minute timestamptz not null, function_name text not null, path text not null, org_id text not null default '',
  requests integer not null default 0, errors integer not null default 0, slow_requests integer not null default 0,
  duration_total_ms bigint not null default 0, duration_max_ms integer not null default 0,
  bucket_lt100 integer not null default 0, bucket_100to499 integer not null default 0,
  bucket_500to999 integer not null default 0, bucket_gte1000 integer not null default 0,
  pool_waiting_max integer not null default 0, pool_total_max integer not null default 0,
  primary key (minute,function_name,path,org_id)
);
create index if not exists performance_minute_recent_idx on performance_minute (minute desc);
create index if not exists performance_minute_tenant_recent_idx on performance_minute (org_id,minute desc) where org_id <> '';
