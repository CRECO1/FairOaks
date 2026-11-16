-- Property tags (#1222Chulie) in task titles / notes: which listings a task is about. Derived server-side on create / edit.
begin;
alter table public.crm_tasks add column if not exists tagged_listing_ids uuid[] not null default '{}';
create index if not exists crm_tasks_tagged_listing_ids_idx on public.crm_tasks using gin (tagged_listing_ids);
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_tasks' and column_name='tagged_listing_ids') then
    raise exception 'crm_tasks.tagged_listing_ids missing';
  end if;
end $$;
commit;
