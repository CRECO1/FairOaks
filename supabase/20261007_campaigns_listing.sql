-- A campaign can name the property it markets (2026-10-07).
--
-- crm_campaign_projects.listing_id already ties a whole project to a listing (the
-- Elkhorn projects). But one project can market two properties (AutoBrite/BeaconHill),
-- and many campaigns sit in no project, so the property is set per campaign too.
-- A campaign's own listing_id wins; when it's null, its project's applies.
-- Drives each property's Prospects list (src/lib/listing-prospects.ts).
alter table crm_campaigns add column if not exists listing_id uuid references crm_listings(id) on delete set null;
create index if not exists crm_campaigns_listing_id_idx on crm_campaigns (listing_id) where listing_id is not null;
