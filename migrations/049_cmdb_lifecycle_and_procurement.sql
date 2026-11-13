-- 049_cmdb_lifecycle_and_procurement.sql
-- Vendor, contract and software-license lifecycle data. Every reference is tenant matched.
create table if not exists cmdb_vendors (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 name text not null check(char_length(name) between 1 and 180),
 website text not null default '' check(char_length(website)<=500),
 support_email text not null default '' check(char_length(support_email)<=254),
 support_phone text not null default '' check(char_length(support_phone)<=80),
 notes text not null default '' check(char_length(notes)<=3000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id),
 unique(org_id,lower(name))
);
create table if not exists cmdb_contracts (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 vendor_id bigint,
 name text not null check(char_length(name) between 1 and 180),
 contract_number text not null default '' check(char_length(contract_number)<=120),
 contract_type text not null default 'support' check(contract_type in ('support','maintenance','subscription','purchase','lease','other')),
 status text not null default 'active' check(status in ('draft','active','expiring','expired','terminated')),
 starts_on date,
 ends_on date,
 renewal_notice_days integer not null default 30 check(renewal_notice_days between 0 and 365),
 auto_renew boolean not null default false,
 annual_cost numeric(14,2),
 currency char(3) not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
 notes text not null default '' check(char_length(notes)<=5000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,vendor_id) references cmdb_vendors(org_id,id) on delete restrict,
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create index if not exists cmdb_contracts_org_end on cmdb_contracts(org_id,ends_on,status);
create table if not exists cmdb_software_licenses (
 id bigserial primary key,
 org_id text not null references "organization"(id) on delete cascade,
 vendor_id bigint,
 contract_id bigint,
 product_name text not null check(char_length(product_name) between 1 and 180),
 publisher text not null default '' check(char_length(publisher)<=180),
 license_type text not null default 'subscription' check(license_type in ('subscription','perpetual','volume','open_source','trial','other')),
 status text not null default 'active' check(status in ('active','trial','expired','cancelled')),
 seats_purchased integer not null default 1 check(seats_purchased>=0),
 seats_assigned integer not null default 0 check(seats_assigned>=0),
 starts_on date,
 ends_on date,
 renewal_date date,
 agreement_reference text not null default '' check(char_length(agreement_reference)<=180),
 annual_cost numeric(14,2),
 currency char(3) not null default 'USD' check(currency ~ '^[A-Z]{3}$'),
 notes text not null default '' check(char_length(notes)<=5000),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,vendor_id) references cmdb_vendors(org_id,id) on delete restrict,
 foreign key(org_id,contract_id) references cmdb_contracts(org_id,id) on delete restrict,
 check(seats_assigned<=seats_purchased),
 check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create index if not exists cmdb_licenses_org_end on cmdb_software_licenses(org_id,ends_on,status);
create index if not exists cmdb_licenses_org_vendor on cmdb_software_licenses(org_id,vendor_id);
alter table configuration_items add column if not exists vendor_id bigint;
alter table configuration_items add column if not exists contract_id bigint;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='configuration_items_org_vendor_fk') then
  alter table configuration_items add constraint configuration_items_org_vendor_fk foreign key(org_id,vendor_id) references cmdb_vendors(org_id,id) on delete restrict;
 end if;
 if not exists(select 1 from pg_constraint where conname='configuration_items_org_contract_fk') then
  alter table configuration_items add constraint configuration_items_org_contract_fk foreign key(org_id,contract_id) references cmdb_contracts(org_id,id) on delete restrict;
 end if;
end $$;
do $$
declare t text;
begin
 foreach t in array array['cmdb_vendors','cmdb_contracts','cmdb_software_licenses'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
