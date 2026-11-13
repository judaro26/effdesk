-- 043_itsm_incident_foundation.sql
-- Workspace-owned service inventory and richer incident metadata. Incidents remain tickets.
create table if not exists business_services (
  id bigserial primary key,
  org_id text not null references "organization"(id) on delete cascade,
  name text not null check(char_length(name) between 1 and 120),
  description text not null default '' check(char_length(description)<=2000),
  owner_id text,
  criticality text not null default 'medium' check(criticality in ('low','medium','high','critical')),
  status text not null default 'operational' check(status in ('operational','degraded','outage','maintenance','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(org_id,name),
  unique(org_id,id)
);
create index if not exists business_services_org_status on business_services(org_id,status,criticality);
create table if not exists incident_details (
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null,
  impact text not null default 'medium' check(impact in ('low','medium','high','critical')),
  urgency text not null default 'medium' check(urgency in ('low','medium','high','critical')),
  severity text not null default 'P3' check(severity in ('P1','P2','P3','P4')),
  is_major boolean not null default false,
  commander_id text,
  public_summary text not null default '' check(char_length(public_summary)<=3000),
  internal_summary text not null default '' check(char_length(internal_summary)<=5000),
  next_update_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(org_id,ticket_id),
  foreign key(org_id,ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists incident_details_org_severity on incident_details(org_id,severity,is_major,updated_at desc);
create table if not exists incident_services (
  org_id text not null,
  ticket_id bigint not null,
  service_id bigint not null,
  created_at timestamptz not null default now(),
  primary key(org_id,ticket_id,service_id),
  foreign key(org_id,ticket_id) references incident_details(org_id,ticket_id) on delete cascade,
  foreign key(org_id,service_id) references business_services(org_id,id) on delete cascade
);
create index if not exists incident_services_service on incident_services(org_id,service_id,ticket_id);
create table if not exists incident_relations (
  org_id text not null references "organization"(id) on delete cascade,
  ticket_id bigint not null,
  related_ticket_id bigint not null,
  relation text not null default 'related' check(relation in ('related','duplicate','caused_by')),
  created_at timestamptz not null default now(),
  primary key(org_id,ticket_id,related_ticket_id),
  check(ticket_id <> related_ticket_id),
  foreign key(org_id,ticket_id) references incident_details(org_id,ticket_id) on delete cascade,
  foreign key(org_id,related_ticket_id) references tickets(org_id,id) on delete cascade
);
create index if not exists incident_relations_related on incident_relations(org_id,related_ticket_id);
do $$
declare t text;
begin
 foreach t in array array['business_services','incident_details','incident_services','incident_relations'] loop
  execute format('alter table %I enable row level security',t);
  execute format('alter table %I force row level security',t);
  execute format('drop policy if exists %I on %I',t||'_tenant',t);
  execute format('create policy %I on %I using (org_id=current_setting(''app.org_id'',true)) with check (org_id=current_setting(''app.org_id'',true))',t||'_tenant',t);
 end loop;
end $$;
