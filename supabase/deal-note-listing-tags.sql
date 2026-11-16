-- Properties #-tagged in deal notes ("#1222Chulie" = the listing at 1222 Chulie Dr): the deal's summary notes, its dated notes
-- and its meeting notes. Silent: nobody is notified. Derived from the note text on every save (summary notes in the browser,
-- dated notes + meetings server-side). Idempotent.
alter table public.crm_deals         add column if not exists tagged_listing_ids uuid[] not null default '{}'::uuid[];
alter table public.crm_deal_notes    add column if not exists tagged_listing_ids uuid[] not null default '{}'::uuid[];
alter table public.crm_deal_meetings add column if not exists tagged_listing_ids uuid[] not null default '{}'::uuid[];
create index if not exists idx_crm_deals_tagged_listings         on public.crm_deals         using gin (tagged_listing_ids);
create index if not exists idx_crm_deal_notes_tagged_listings    on public.crm_deal_notes    using gin (tagged_listing_ids);
create index if not exists idx_crm_deal_meetings_tagged_listings on public.crm_deal_meetings using gin (tagged_listing_ids);
