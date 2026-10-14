-- Call-log notes also live on the contact's card.
-- crm_client_activities is what the contact card's Activity list reads; the Calling Log / Call Queue
-- keep their notes on crm_call_log.notes (and some server paths wrote only crm_activity), so a
-- note typed against a call never showed on the person it was about.
-- call_log_id ties ONE card entry to ONE call, so the note can be updated in place, never doubled.
alter table crm_client_activities add column if not exists call_log_id uuid;
create unique index if not exists crm_client_activities_call_log_uniq
  on crm_client_activities (call_log_id) where call_log_id is not null;
