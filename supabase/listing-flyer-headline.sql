-- Optional one-line headline printed over the flyer cover photo (applied 2026-10-22). Blank = no headline.
alter table public.crm_listings add column if not exists flyer_headline text;
