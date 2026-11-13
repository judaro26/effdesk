-- 048_configuration_items.sql
-- Tenant-scoped asset inventory and the first CMDB relationship layer.
create table if not exists configuration_items (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 asset_tag text,
 name text not null check(char_length(name) between 1 and 180),
 ci_type text not null default 'hardware' check(ci_type in ('hardware','software','application','database','network','cloud_resource','service','other')),
 lifecycle text not null default 'in_use' check(lifecycle in ('planned','in_use','in_repair','retired','disposed')),
 criticality text not null default 'medium' check(criticality in ('low','medium','high','critical')),
 description text not null default '' check(char_length(description)<=5000),
 manufacturer text not null default '' check(char_length(manufacturer)<=120),
 model text not null default '' check(char_length(model)<=120),
 serial_number text not null default '' check(char_length(serial_number)<=180),
 location text not null default '' check(char_length(location)<=240),
 owner_id text,
 business_service_id bigint,
 purchase_date date,
 warranty_expires_at date,
 metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
 created_by text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,business_service_id) references business_services(org_id,id) on delete restrict
);
create unique index if not exists configuration_items_org_asset_tag_uq on configuration_items(org_id,lower(asset_tag)) where asset_tag is not null and asset_tag<>'';
create index if not exists configuration_items_org_lifecycle on configuration_items(org_id,lifecycle,criticality,updated_at desc);
create index if not exists configuration_items_org_type on configuration_items(org_id,ci_type,lower(name));
create index if not exists configuration_items_org_service on configuration_items(org_id,business_service_id);
create table if not exists configuration_item_relationships (
 org_id text not null,
 source_ci_id bigint not null,
 target_ci_id bigint not null,
 relationship text not null check(relationship in ('depends_on','runs_on','hosted_on','connects_to','managed_by')),
 created_by text,
 created_at timestamptz not null default now(),
 primary key(org_id,source_ci_id,target_ci_id,relationship),
 check(source_ci_id<>target_ci_id),
 foreign key(org_id,source_ci_id) references configuration_items(org_id,id) on delete cascade,
 foreign key(org_id,target_ci_id) references configuration_items(org_id,id) on delete cascade
);
create index if not exists configuration_item_relationships_target on configuration_item_relationships(org_id,target_ci_id);
create table if not exists configuration_item_events (
 id bigserial primary key,
 org_id text not null,
 ci_id bigint not null,
 actor_id text,
 actor_name text not null default '',
 event text not null check(event in ('created','updated','relationship_added','record_linked','record_unlinked')),
 detail text not null default '' check(char_length(detail)<=2000),
 created_at timestamptz not null default now(),
 foreign key(org_id,ci_id) references configuration_items(org_id,id) on delete cascade
);
create index if not exists configuration_item_events_ci on configuration_item_events(org_id,ci_id,created_at desc);
create table if not exists configuration_item_tickets (
 org_id text not null,
 ci_id bigint not null,
 ticket_id bigint not null,
 created_at timestamptz not null default now(),
 primary key(org_id,ci_id,ticket_id),
 foreign key(org_id,ci_id) references configuration_items(org_id,id) on delete cascade,
 foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create table if not exists configuration_item_problems (
 org_id text not null,
 ci_id bigint not null,
 problem_id bigint not null,
 created_at timestamptz not null default now(),
 primary key(org_id,ci_id,problem_id),
 foreign key(org_id,ci_id) references configuration_items(org_id,id) on delete cascade,
 foreign key(org_id,problem_id) references problems(org_id,id) on delete cascade
);
create table if not exists configuration_item_changes (
 org_id text not null,
 ci_id bigint not null,
 change_id bigint not null,
 created_at timestamptz not null default now(),
 primary key(org_id,ci_id,change_id),
 foreign key(org_id,ci_id) references configuration_items(org_id,id) on delete cascade,
 foreign key(org_id,change_id) references change_requests(org_id,id) on delete cascade
);
do $$
declare t text;
begin
 foreach t in array array['configuration_items','configuration_item_relationships','configuration_item_events','configuration_item_tickets','configuration_item_problems','configuration_item_changes'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
