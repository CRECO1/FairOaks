-- "Targeted": the properties a contact was reached out to about in an OUTREACH list (not an inquiry). Kept apart from tagged_listing_ids so the
-- property's "asked" count stays honest. Set only by the admin review screen ("Mark as targeted"); never derived from note text.
begin;
alter table public.crm_clients add column if not exists targeted_listing_ids uuid[] not null default '{}';
create index if not exists crm_clients_targeted_listing_ids_idx on public.crm_clients using gin (targeted_listing_ids);
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_clients' and column_name='targeted_listing_ids') then
    raise exception 'crm_clients.targeted_listing_ids missing';
  end if;
end $$;
commit;
