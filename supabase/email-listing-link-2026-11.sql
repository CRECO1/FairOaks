-- A personal (one-to-one) email can now be tied to the property it markets, so it shows up on that property's Prospects list / tracker
-- sheet by itself (2026-11-04, Zack: emails "need to flow automatically to those property lists"). The send route sets listing_id from the
-- property flyer attached to the email.
begin;
alter table public.crm_deal_emails add column if not exists listing_id uuid references public.crm_listings(id) on delete set null;
create index if not exists crm_deal_emails_listing_idx on public.crm_deal_emails (listing_id) where listing_id is not null;
-- Robert's 14 French Pl emails of 2026-11-04 went out with the lease flyer attached before this existed.
update public.crm_deal_emails set listing_id = '04c7ff50-8b2d-44db-8c38-980160ca9bf3'
 where listing_id is null and direction = 'sent' and subject like '%1353 W French Pl%' and subject not ilike '%SAMPLE%' and lower(from_email) like '%robert@crecotx.com%';
commit;
-- Rollback: alter table public.crm_deal_emails drop column listing_id;
