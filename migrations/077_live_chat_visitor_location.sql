-- 077_live_chat_visitor_location.sql
-- Store coarse coordinates only when a visitor explicitly shares their location.
alter table ticket_provenance
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;
alter table ticket_provenance
  drop constraint if exists ticket_provenance_coordinates_valid;
alter table ticket_provenance
  add constraint ticket_provenance_coordinates_valid
  check (
    (latitude is null and longitude is null)
    or (latitude between -90 and 90 and longitude between -180 and 180)
  );
