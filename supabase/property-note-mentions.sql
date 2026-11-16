-- Property tags (#1222Chulie) inside notes ON OTHER PROPERTIES (a property's Internal Notes, a floor-plan suite note, a rent-roll note,
-- a vendor / building note): which properties a note mentions. Derived server-side on save. Shown as "Mentioned in notes on other
-- properties" on the mentioned property, separate from the inquiry counts.
begin;
alter table public.crm_listings        add column if not exists mentioned_listing_ids uuid[] not null default '{}';
alter table public.office_suites       add column if not exists mentioned_listing_ids uuid[] not null default '{}';
alter table public.crm_property_tenants add column if not exists mentioned_listing_ids uuid[] not null default '{}';
alter table public.crm_listing_vendors add column if not exists mentioned_listing_ids uuid[] not null default '{}';
create index if not exists crm_listings_mentioned_idx on public.crm_listings using gin (mentioned_listing_ids);
create index if not exists office_suites_mentioned_idx on public.office_suites using gin (mentioned_listing_ids);
create index if not exists crm_property_tenants_mentioned_idx on public.crm_property_tenants using gin (mentioned_listing_ids);
create index if not exists crm_listing_vendors_mentioned_idx on public.crm_listing_vendors using gin (mentioned_listing_ids);
do $$ declare n int; begin
  select count(*) into n from information_schema.columns where table_schema='public' and column_name='mentioned_listing_ids'
    and table_name in ('crm_listings','office_suites','crm_property_tenants','crm_listing_vendors');
  if n <> 4 then raise exception 'expected 4 mentioned_listing_ids columns, found %', n; end if;
end $$;
commit;
