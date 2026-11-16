-- Properties #-tagged in a call's note ("#1222Chulie" = the listing at 1222 Chulie Dr), so the team can see which property
-- a caller asked about even when the caller is not a contact yet. Silent: nobody is notified. Derived server-side from the
-- note text on every save (POST/PATCH /api/crm/calls) and copied onto the contact's activity by the call-note mirror.
-- Idempotent.
alter table public.crm_call_log add column if not exists tagged_listing_ids uuid[] not null default '{}'::uuid[];
create index if not exists idx_crm_call_log_tagged_listings on public.crm_call_log using gin (tagged_listing_ids);
