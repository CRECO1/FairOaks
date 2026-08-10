-- Lease-expiration prospecting: marks the expiration date we last auto-created a
-- renewal call for, so re-running (or the daily cron) never duplicates — and a
-- renewal (new lease_expiration_date) naturally re-arms it.
ALTER TABLE crm_clients ADD COLUMN IF NOT EXISTS lxp_prospected_for date;
