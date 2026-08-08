-- ============================================================================
-- Property DB expansion — turn crm_prospective_properties into a full
-- LoopNet/Crexi-grade commercial real-estate record, plus a tenant roster and
-- a change-history log so the intelligence compounds over time.
--
-- Run in the Supabase SQL editor (project bnqdzgypesoythpbeujk).
-- 100% ADDITIVE: every column is nullable, every table is new. Nothing existing
-- breaks; the current Properties page keeps working, just doesn't show the new
-- fields until the frontend is updated later.
-- ============================================================================

-- ── 1. crm_prospective_properties: richer building record ───────────────────
alter table public.crm_prospective_properties
  -- Location & identity
  add column if not exists county            text,
  add column if not exists submarket         text,
  add column if not exists latitude          numeric,
  add column if not exists longitude         numeric,
  add column if not exists parcel_apn        text,      -- appraisal-district parcel / APN

  -- Building & physical
  add column if not exists property_subtype  text,      -- e.g. Warehouse/Distribution, Flex, Strip Center, Medical
  add column if not exists building_class     text,      -- A / B / C
  add column if not exists year_built         integer,
  add column if not exists year_renovated     integer,
  add column if not exists lot_size_acres     numeric,
  add column if not exists office_sf          numeric,
  add column if not exists num_buildings      integer,
  add column if not exists stories            integer,
  add column if not exists construction_type  text,
  add column if not exists zoning             text,
  add column if not exists parking_spaces     integer,
  add column if not exists parking_ratio      text,      -- e.g. "3.5/1,000 SF"
  add column if not exists occupancy_pct      numeric,   -- % leased

  -- Industrial / flex specs
  add column if not exists clear_height_ft    numeric,
  add column if not exists dock_doors         integer,
  add column if not exists grade_doors        integer,   -- grade / drive-in
  add column if not exists power              text,       -- e.g. "3-phase / 800A"
  add column if not exists sprinklered        text,       -- e.g. "ESFR", "wet", "none"
  add column if not exists column_spacing     text,
  add column if not exists rail_access        boolean,
  add column if not exists ios_yard           boolean,    -- industrial outdoor storage / yard

  -- Retail specifics
  add column if not exists frontage_ft        numeric,
  add column if not exists traffic_count      integer,    -- vehicles/day
  add column if not exists anchor_tenant      text,
  add column if not exists co_tenants         text,

  -- Office specifics
  add column if not exists floor_plate_sf     numeric,

  -- Transaction & financials
  add column if not exists listing_type       text,       -- For Sale / For Lease / Both / Sold / Off-Market
  add column if not exists sale_price         numeric,
  add column if not exists price_per_sf       numeric,
  add column if not exists cap_rate           numeric,
  add column if not exists noi                numeric,
  add column if not exists lease_rate_min     numeric,    -- $/SF/yr
  add column if not exists lease_rate_max     numeric,
  add column if not exists lease_type         text,       -- NNN / FSG / MG / IG
  add column if not exists opex_psf           numeric,
  add column if not exists available_sf       numeric,
  add column if not exists divisible          boolean,

  -- Ownership
  add column if not exists owner_name         text,
  add column if not exists owner_contact      text,
  add column if not exists owner_phone        text,

  -- Location intelligence
  add column if not exists flood_zone         text,
  add column if not exists opportunity_zone   boolean,

  -- Marketing & media
  add column if not exists description        text,
  add column if not exists highlights         text[],
  add column if not exists features           text[],
  add column if not exists photos             text[],     -- image URLs
  add column if not exists brochure_url       text,
  add column if not exists flyer_url          text,
  add column if not exists floorplan_url      text,
  add column if not exists listing_url        text,       -- Crexi/LoopNet/source link
  add column if not exists virtual_tour_url   text,

  -- Dates & freshness
  add column if not exists date_listed        date,
  add column if not exists date_sold          date,
  add column if not exists available_date     date,
  add column if not exists last_verified_at   timestamptz,

  -- Relationship links — tie a property to the people/deals you already track
  add column if not exists listing_agent_id   uuid references public.crm_outside_agents (id) on delete set null,
  add column if not exists owner_client_id    uuid references public.crm_clients (id)        on delete set null,
  add column if not exists deal_id            uuid references public.crm_deals (id)          on delete set null,

  -- Comps engine — Sold/Leased records with price+date+SF become your comp set
  add column if not exists transaction_status text,      -- Available / Under Contract / Sold / Leased / Off-Market

  -- Dedupe guard — normalized address key (populated by app/pipeline)
  add column if not exists address_key        text,

  -- Flexible categorization
  add column if not exists tags               text[];

-- Helpful indexes for search/filtering
create index if not exists idx_cpp_property_subtype on public.crm_prospective_properties (property_subtype);
create index if not exists idx_cpp_listing_type     on public.crm_prospective_properties (listing_type);
create index if not exists idx_cpp_submarket        on public.crm_prospective_properties (submarket);
create index if not exists idx_cpp_geo              on public.crm_prospective_properties (latitude, longitude);

-- Relationship-link lookups
create index if not exists idx_cpp_listing_agent on public.crm_prospective_properties (listing_agent_id);
create index if not exists idx_cpp_owner_client  on public.crm_prospective_properties (owner_client_id);
create index if not exists idx_cpp_deal          on public.crm_prospective_properties (deal_id);

-- Comps: fast filtering to Sold/Leased records (your sale & lease comp set)
create index if not exists idx_cpp_txn_status on public.crm_prospective_properties (transaction_status);
create index if not exists idx_cpp_comps      on public.crm_prospective_properties (transaction_status, property_subtype, submarket);

-- Tags filtering
create index if not exists idx_cpp_tags on public.crm_prospective_properties using gin (tags);

-- Address key: NON-UNIQUE by design. A single building can legitimately carry
-- multiple listings (different brokers) or spaces marketed separately, so we do
-- NOT hard-block same-address rows. The app-layer dedup still catches accidental
-- exact re-sends; this index just makes address matching / rollups fast.
-- (The proper model — one building parent → many listings/suites — is a later
-- design step.)
create index if not exists idx_cpp_address_key
  on public.crm_prospective_properties (address_key);

-- ── 2. crm_property_suites: richer per-suite/space record ───────────────────
alter table public.crm_property_suites
  add column if not exists floor            text,
  add column if not exists suite_type       text,        -- Office / Warehouse / Retail / Flex
  add column if not exists available_sf     numeric,
  add column if not exists lease_rate_min   numeric,
  add column if not exists lease_rate_max   numeric,
  add column if not exists lease_type       text,
  add column if not exists available_date   date,
  add column if not exists last_verified_at timestamptz;

-- ── 3. crm_property_tenants: rent roll / tenant roster (one-to-many) ─────────
create table if not exists public.crm_property_tenants (
  id               uuid primary key default gen_random_uuid(),
  property_id      uuid references public.crm_prospective_properties (id) on delete cascade,
  suite_id         uuid references public.crm_property_suites (id) on delete set null,
  business_unit    text default 'commercial',
  tenant_name      text,
  suite            text,
  size_sf          numeric,
  lease_start      date,
  lease_expiration date,
  monthly_rent     numeric,
  notes            text,
  created_by       uuid,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);
create index if not exists idx_cpt_property on public.crm_property_tenants (property_id);

-- ── 4. crm_property_history: append-only change log (compounding intel) ──────
-- Every time a status, price, rate, availability, or owner changes, log it so
-- you build a history nobody else has (e.g. asking-rate trend, days-on-market).
create table if not exists public.crm_property_history (
  id            uuid primary key default gen_random_uuid(),
  property_id   uuid references public.crm_prospective_properties (id) on delete cascade,
  field         text,        -- 'vacancy_status' | 'sale_price' | 'lease_rate' | 'available_sf' | 'owner' | ...
  old_value     text,
  new_value     text,
  source        text,        -- agent_call | broker_email | crexi | loopnet | manual
  changed_by    uuid,
  changed_at    timestamptz default now()
);
create index if not exists idx_cph_property on public.crm_property_history (property_id, changed_at desc);

-- ── 5. RLS for the two new tables (internal CRM access) ─────────────────────
-- Mirror the "authenticated users can access" posture of the CRM's internal
-- tables. If your other crm_* tables use a stricter policy (e.g. org-scoped),
-- tell me and I'll match it exactly instead.
alter table public.crm_property_tenants  enable row level security;
alter table public.crm_property_history  enable row level security;

drop policy if exists "crm_property_tenants authenticated" on public.crm_property_tenants;
create policy "crm_property_tenants authenticated" on public.crm_property_tenants
  for all to authenticated using (true) with check (true);

drop policy if exists "crm_property_history authenticated" on public.crm_property_history;
create policy "crm_property_history authenticated" on public.crm_property_history
  for all to authenticated using (true) with check (true);

-- Verify:
--   select count(*) from information_schema.columns
--     where table_name = 'crm_prospective_properties';
