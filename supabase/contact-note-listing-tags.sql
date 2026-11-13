-- Properties #-tagged in a contact's notes ("#1222Chulie" = the listing at 1222 Chulie Dr), so the team can see which
-- properties a contact asked about even when no deal exists. Silent: nobody is notified. Same idea as tagged_contact_ids.
-- Derived from the note text on every save (contact notes) and on every logged touch (activities). Idempotent.
alter table public.crm_clients            add column if not exists tagged_listing_ids uuid[] not null default '{}'::uuid[];
alter table public.crm_client_activities  add column if not exists tagged_listing_ids uuid[] not null default '{}'::uuid[];
create index if not exists idx_crm_clients_tagged_listings           on public.crm_clients           using gin (tagged_listing_ids);
create index if not exists idx_crm_client_activities_tagged_listings on public.crm_client_activities using gin (tagged_listing_ids);
