-- 055_github_gitlab_issue_links.sql
-- Allow the shared ticket issue-link table to reference GitHub and GitLab issues.
-- Provider credentials remain in integration_connections, not project_integrations.
alter table project_issue_links drop constraint if exists project_issue_links_provider_check;
alter table project_issue_links
  add constraint project_issue_links_provider_check
  check (provider in ('linear','jira','github','gitlab'));
