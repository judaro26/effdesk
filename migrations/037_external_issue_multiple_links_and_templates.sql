-- 037_external_issue_multiple_links.sql
-- A ticket may be associated with multiple issues in the same external provider.
alter table project_issue_links
  drop constraint if exists project_issue_links_org_id_provider_ticket_number_key;
create index if not exists project_issue_links_ticket_lookup
  on project_issue_links(org_id, ticket_number, provider);
