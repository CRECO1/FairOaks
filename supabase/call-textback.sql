-- Missed-call text-back (2026-10-07): when someone calls and nobody answers, text them
-- "sorry we missed you" from the number they dialed. One text per call; these columns
-- record what happened so a call is never texted twice and failures are visible.
alter table crm_call_log add column if not exists textback_at timestamptz;
alter table crm_call_log add column if not exists textback_status text;   -- 'sent' | 'failed' | 'skipped:<why>'
alter table crm_call_log add column if not exists textback_error text;
create index if not exists crm_call_log_textback_idx on crm_call_log (business_unit, started_at desc) where textback_status is null and handled_at is null;
