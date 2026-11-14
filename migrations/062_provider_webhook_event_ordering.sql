-- Track the provider's own event time so delayed webhook deliveries cannot roll
-- an incident/alert back to an older state. Null preserves compatibility with
-- providers or legacy events that do not include a usable event timestamp.
alter table incident_provider_links
  add column if not exists provider_event_at timestamptz;
alter table monitoring_alert_links
  add column if not exists provider_event_at timestamptz;
