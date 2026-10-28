-- crm_deal_emails.email_date is a DATE, so several emails on one day have no real order — "last message in the thread"
-- (Reply / Reply all / the quoted text) can pick the wrong one. email_at is the actual time of the message
-- (Gmail's internalDate; now() for CRM sends). The UI falls back to created_at while it is null.
-- NOT YET APPLIED to production (needs the owner's go-ahead); the app does not write this column until it is.
alter table public.crm_deal_emails add column if not exists email_at timestamptz;
-- CRM-sent rows were created at the moment of sending, which IS their time.
update public.crm_deal_emails set email_at = created_at where email_at is null and direction = 'sent' and tracked = true;
