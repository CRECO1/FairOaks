-- Optional: print the property's photos on their own page 2 of the flyer (floor plan + map move to page 3). Default off.
alter table public.crm_listings add column if not exists flyer_split_pages boolean not null default false;
