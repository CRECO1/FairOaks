-- Marks the lease expiration date a Rent Roll row has already had a renewal-outreach task made for (same idea as
-- crm_clients.lxp_prospected_for). A renewed lease (new date) re-arms it. Idempotent.
alter table public.crm_property_tenants add column if not exists lxp_prospected_for date;
