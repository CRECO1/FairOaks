-- Leasing Activity: leads flow in automatically (website inquiries, email replies,
-- calls/texts, deals at the property) as prospect rows on the property's report.
alter table public.crm_property_tenants
  add column if not exists lead_source text,      -- Website inquiry | Email reply | Call / text | Deal | (null = added by hand)
  add column if not exists lead_ref    text;      -- 'deal:<id>' for deal-driven rows (status follows the deal)
create index if not exists crm_property_tenants_listing_contact_idx on public.crm_property_tenants(listing_id, contact_id);

alter table public.crm_listings
  add column if not exists lead_keywords   text[],       -- matched against a lead's site / landing page / page path
  add column if not exists leads_synced_at timestamptz;

update public.crm_listings
   set lead_keywords = array['elkhornpoint.com', '8923-dietz-elkhorn', 'elkhorn-point']
 where id = '342b6fd8-6fa8-400b-bd0f-7f8eb456c2b9' and lead_keywords is null;
