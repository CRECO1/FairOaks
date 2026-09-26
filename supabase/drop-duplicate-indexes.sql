-- Two tables each carry the same column indexed twice.
--
--   email_tracking_events.tracking_id
--     email_tracking_events_tracking_id_key   UNIQUE, backs the UNIQUE constraint
--     idx_email_tracking_tracking_id          plain btree, redundant
--
--   email_lead_imports.gmail_message_id
--     email_lead_imports_gmail_message_id_key UNIQUE, backs the UNIQUE constraint
--     idx_email_lead_imports_message_id       plain btree, redundant
--
-- A unique btree serves every read a plain btree on the same column would, so
-- the plain one only costs write throughput and disk. Dropping the UNIQUE ones
-- is not an option and not wanted: the Resend webhook's idempotency depends on
-- email_tracking_events.tracking_id being unique, and the importer's re-import
-- guard depends on gmail_message_id being unique. Only the plain duplicates go.

drop index if exists public.idx_email_tracking_tracking_id;
drop index if exists public.idx_email_lead_imports_message_id;
