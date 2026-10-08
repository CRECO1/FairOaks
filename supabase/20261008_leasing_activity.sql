-- Leasing Activity report (property card) — the owner/developer's weekly leasing
-- activity sheet (Headwall's template) kept as a living document in the CRM.
--
-- Rows stay in crm_property_tenants: the rent roll's suite rows are the vacancies /
-- expirations, and its "backup / prospective tenant" rows (is_backup) are the
-- prospects working a suite. These columns carry the report's extra fields.
alter table public.crm_property_tenants
  add column if not exists leasing_status text,          -- Prospect | Touring | Proposal Out | LOI Out | Lease Out | Signed | Passed
  add column if not exists tenant_use     text,          -- Use column (e.g. "Medical — dental")
  add column if not exists activity_date  date,          -- Date of the latest step
  add column if not exists proposed_rent  numeric,       -- $/SF/yr
  add column if not exists proposed_ti    numeric,       -- $/SF
  add column if not exists is_national    boolean,
  add column if not exists renewal_type   text,
  add column if not exists prev_rent_psf  numeric;

-- Report header: the owner's fund label for this property ("Fund: Fair Oaks").
alter table public.crm_listings add column if not exists report_fund text;
update public.crm_listings set report_fund = 'Fair Oaks'
 where id = '342b6fd8-6fa8-400b-bd0f-7f8eb456c2b9' and report_fund is null;

-- Floor-plan safety: office_suites only ever drew 8000 Fair Oaks Pkwy, and the rent
-- roll mirrored edits onto it by suite_number alone — so any other property using
-- "102" or "203" would have overwritten a Fair Oaks Plaza suite. Tie each drawn suite
-- to its property and scope the mirror to it.
alter table public.office_suites
  add column if not exists listing_id uuid references public.crm_listings(id) on delete set null;
update public.office_suites set listing_id = '12e83ca0-539f-48d0-bf0e-579503d9a147'
 where listing_id is null and business_unit = 'commercial';
