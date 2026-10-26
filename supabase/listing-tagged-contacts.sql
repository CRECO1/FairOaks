-- Contacts @-tagged in a property's Internal Notes (silent — the contact is never notified), same idea as
-- crm_deals.tagged_contact_ids / crm_clients.tagged_contact_ids. Derived from the note text on every save.
-- Idempotent.
alter table public.crm_listings add column if not exists tagged_contact_ids uuid[] not null default '{}'::uuid[];
create index if not exists idx_crm_listings_tagged_contacts on public.crm_listings using gin (tagged_contact_ids);
