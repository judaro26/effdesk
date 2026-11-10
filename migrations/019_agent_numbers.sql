-- 019_agent_numbers.sql: every person gets a short, permanent agent number (shown in desk addresses like /w/acme/agent/10042/tickets).
create sequence if not exists agent_number_seq start 10001;
alter table "user" add column if not exists agent_number bigint unique default nextval('agent_number_seq');
