-- Fine-grained sampled SQL timings and aggregate real-user Core Web Vitals.
create table if not exists performance_query_minute (
  minute timestamptz not null, query_hash text not null, operation text not null, function_name text not null, org_id text not null default '',
  samples integer not null default 0, errors integer not null default 0, total_ms bigint not null default 0, max_ms integer not null default 0,
  bucket_lt25 integer not null default 0, bucket_25to99 integer not null default 0, bucket_100to499 integer not null default 0, bucket_gte500 integer not null default 0,
  primary key (minute,query_hash,operation,function_name,org_id)
);
create index if not exists performance_query_recent_idx on performance_query_minute (minute desc);
create table if not exists performance_vitals_minute (
  minute timestamptz not null, org_id text not null, page text not null, device text not null, metric text not null,
  samples integer not null default 0, total_value double precision not null default 0, max_value double precision not null default 0,
  good_count integer not null default 0, needs_improvement_count integer not null default 0, poor_count integer not null default 0,
  primary key (minute,org_id,page,device,metric)
);
create index if not exists performance_vitals_recent_idx on performance_vitals_minute (minute desc);
create index if not exists performance_vitals_tenant_recent_idx on performance_vitals_minute (org_id,minute desc);
