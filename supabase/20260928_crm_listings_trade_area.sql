-- Flyer trade-area strip (traffic counts / ring demographics) per listing.
-- Read by src/app/api/crm/listings/[id]/flyer/route.ts; absent on most listings.
-- Run in the Supabase SQL editor for project bnqdzgypesoythpbeujk (CRM).
alter table public.crm_listings add column if not exists trade_area jsonb;
comment on column public.crm_listings.trade_area is 'Flyer trade-area strip: { tiles: [{ value, label }] (max 4), caption }. Filled from TxDOT AADT + Census ring pulls.';
