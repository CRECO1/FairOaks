-- Link a campaign project to the property it markets, so the property's Rent Roll tab
-- can show everyone those campaigns emailed and how they engaged (Email Prospects).
alter table public.crm_campaign_projects
  add column if not exists listing_id uuid references public.crm_listings(id) on delete set null;
create index if not exists crm_campaign_projects_listing_id_idx on public.crm_campaign_projects(listing_id);

-- Elkhorn Point: every Elkhorn outreach project (pre-leasing waves, US-281 corridor,
-- back-lot / back-pad disposition, and the retired 8979 series) rolls up to the
-- Elkhorn Point listing, so "anyone who opened any Elkhorn email" is one list.
update public.crm_campaign_projects
   set listing_id = '342b6fd8-6fa8-400b-bd0f-7f8eb456c2b9'
 where id in ('13da1f8c-07fc-4438-9cb8-a3cb735cb0a7',   -- Pre-Leasing Outreach 2026
              'f4accb5b-9f8a-4717-9bbd-5279caec538d',   -- US-281 Corridor Outreach
              'a4d14a3f-821d-4b25-b3f2-471eca48ddc3',   -- Back-Lot Disposition
              '95884aa8-7b3d-4844-8f8e-53ba501c9622',   -- Back Pad Disposition
              'a3503c45-bfec-4476-8aac-9b4ede487b16');  -- [RETIRED] 8979 Dietz Elkhorn
