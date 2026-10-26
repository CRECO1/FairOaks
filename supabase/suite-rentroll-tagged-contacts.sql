-- Contacts @-tagged in suite notes (Floor Plan), Rent Roll notes and vendor / building notes — silent, never
-- notified. Same idea as crm_listings.tagged_contact_ids; derived from the note text on every save. Idempotent.
alter table public.office_suites        add column if not exists tagged_contact_ids uuid[] not null default '{}'::uuid[];
alter table public.crm_property_tenants add column if not exists tagged_contact_ids uuid[] not null default '{}'::uuid[];
alter table public.crm_listing_vendors  add column if not exists tagged_contact_ids uuid[] not null default '{}'::uuid[];
create index if not exists idx_office_suites_tagged_contacts        on public.office_suites        using gin (tagged_contact_ids);
create index if not exists idx_crm_property_tenants_tagged_contacts on public.crm_property_tenants using gin (tagged_contact_ids);
create index if not exists idx_crm_listing_vendors_tagged_contacts  on public.crm_listing_vendors  using gin (tagged_contact_ids);
