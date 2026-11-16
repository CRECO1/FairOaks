-- Property tagging round 9: remember which outreach contacts already got a second-touch DRAFT prepared, so the weekly job never prepares the same one twice
-- (the drafts are only ever saved for the agent to review and send themselves).
begin;
alter table public.crm_clients add column if not exists second_touch_drafted_at timestamptz;
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_clients' and column_name='second_touch_drafted_at') then raise exception 'crm_clients.second_touch_drafted_at missing'; end if;
end $$;
commit;
