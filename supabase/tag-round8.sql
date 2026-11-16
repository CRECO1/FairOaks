-- Property tagging round 8: merging duplicate property rows (the same address saved twice) with an undo.
--  crm_listing_merges: one row per merge: what moved (so it can be moved back) and the duplicate's row as it was. RLS on, no policies (API / service key only).
--  crm_merge_listings(keeper, dup, by): moves every row that points at the duplicate (the 12 tables with a listing_id foreign key) onto the keeper, swaps the
--    duplicate's id for the keeper's inside the tag arrays (tagged / targeted / mentioned), and marks the duplicate row status = 'merged' (it is NEVER deleted).
--    A row that would break a uniqueness rule on the keeper (e.g. the same contact + role already linked) simply stays on the duplicate.
--  crm_unmerge_listings(merge_id): puts everything back exactly as recorded. All inside the caller's transaction: either it all happens or none of it.
begin;

create table if not exists public.crm_listing_merges (
  id uuid primary key default gen_random_uuid(),
  keeper uuid not null,
  dup uuid not null,
  merged_by uuid,
  merged_at timestamptz not null default now(),
  moved jsonb not null default '{}'::jsonb,
  arrays jsonb not null default '{}'::jsonb,
  dup_before jsonb,
  undone_at timestamptz
);
alter table public.crm_listing_merges enable row level security;

create or replace function public.crm_merge_listings(p_keeper uuid, p_dup uuid, p_by uuid)
returns jsonb language plpgsql as $fn$
declare
  r record; rec record; rid uuid; ids uuid[]; moved jsonb := '{}'::jsonb; arrs jsonb := '{}'::jsonb;
  dupbefore jsonb; mid uuid; lst jsonb; pair text[];
  specs text[] := array[
    'crm_clients.tagged_listing_ids','crm_clients.targeted_listing_ids','crm_client_activities.tagged_listing_ids','crm_call_log.tagged_listing_ids',
    'crm_deals.tagged_listing_ids','crm_deal_notes.tagged_listing_ids','crm_deal_meetings.tagged_listing_ids','crm_tasks.tagged_listing_ids',
    'crm_listings.mentioned_listing_ids','office_suites.mentioned_listing_ids','crm_property_tenants.mentioned_listing_ids','crm_listing_vendors.mentioned_listing_ids'];
  s text;
begin
  if p_keeper = p_dup then raise exception 'keeper and duplicate are the same listing'; end if;
  if not exists (select 1 from public.crm_listings where id = p_keeper) then raise exception 'keeper listing not found'; end if;
  select to_jsonb(l) into dupbefore from public.crm_listings l where l.id = p_dup;
  if dupbefore is null then raise exception 'duplicate listing not found'; end if;
  if coalesce(dupbefore->>'status','') = 'merged' then raise exception 'that listing is already merged'; end if;

  for r in
    select c.conrelid::regclass::text as tbl, a.attname::text as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'public.crm_listings'::regclass and array_length(c.conkey, 1) = 1
  loop
    ids := '{}';
    for rid in execute format('select id from %s where %I = $1', r.tbl, r.col) using p_dup loop
      begin
        execute format('update %s set %I = $1 where id = $2', r.tbl, r.col) using p_keeper, rid;
        ids := ids || rid;
      exception when unique_violation then null;
      end;
    end loop;
    if coalesce(array_length(ids, 1), 0) > 0 then moved := moved || jsonb_build_object(r.tbl || '.' || r.col, to_jsonb(ids)); end if;
  end loop;

  foreach s in array specs loop
    pair := string_to_array(s, '.');
    lst := '[]'::jsonb;
    for rec in execute format('select id, (%I @> array[$1]) as had from public.%I where %I @> array[$2]', pair[2], pair[1], pair[2]) using p_keeper, p_dup loop
      execute format('update public.%I set %I = (select coalesce(array_agg(distinct x), ''{}''::uuid[]) from unnest(array_replace(%I, $1, $2)) x) where id = $3', pair[1], pair[2], pair[2])
        using p_dup, p_keeper, rec.id;
      lst := lst || jsonb_build_array(jsonb_build_object('id', rec.id, 'had', rec.had));
    end loop;
    if jsonb_array_length(lst) > 0 then arrs := arrs || jsonb_build_object(s, lst); end if;
  end loop;

  update public.crm_listings set status = 'merged', updated_at = now() where id = p_dup;
  insert into public.crm_listing_merges (keeper, dup, merged_by, moved, arrays, dup_before) values (p_keeper, p_dup, p_by, moved, arrs, dupbefore) returning id into mid;
  return jsonb_build_object('merge_id', mid, 'moved', moved, 'arrays', arrs);
end
$fn$;

create or replace function public.crm_unmerge_listings(p_merge uuid)
returns jsonb language plpgsql as $fn$
declare
  m record; k record; e jsonb; pair text[]; ids uuid[]; n int := 0;
begin
  select * into m from public.crm_listing_merges where id = p_merge;
  if m.id is null then raise exception 'merge not found'; end if;
  if m.undone_at is not null then raise exception 'that merge was already undone'; end if;

  for k in select key, value from jsonb_each(m.moved) loop
    pair := string_to_array(k.key, '.');
    ids := array(select jsonb_array_elements_text(k.value)::uuid);
    execute format('update %s set %I = $1 where id = any($2) and %I = $3', pair[1], pair[2], pair[2]) using m.dup, ids, m.keeper;
    n := n + coalesce(array_length(ids, 1), 0);
  end loop;

  for k in select key, value from jsonb_each(m.arrays) loop
    pair := string_to_array(k.key, '.');
    for e in select * from jsonb_array_elements(k.value) loop
      if (e->>'had')::boolean then
        execute format('update public.%I set %I = array_append(%I, $1) where id = $2 and not (%I @> array[$1])', pair[1], pair[2], pair[2], pair[2]) using m.dup, (e->>'id')::uuid;
      else
        execute format('update public.%I set %I = array_replace(%I, $1, $2) where id = $3', pair[1], pair[2], pair[2]) using m.keeper, m.dup, (e->>'id')::uuid;
      end if;
    end loop;
  end loop;

  update public.crm_listings set status = coalesce(m.dup_before->>'status', 'active'), updated_at = now() where id = m.dup;
  update public.crm_listing_merges set undone_at = now() where id = p_merge;
  return jsonb_build_object('restored_rows', n);
end
$fn$;

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='crm_listing_merges') then raise exception 'crm_listing_merges missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'crm_merge_listings') then raise exception 'crm_merge_listings missing'; end if;
  if not exists (select 1 from pg_proc where proname = 'crm_unmerge_listings') then raise exception 'crm_unmerge_listings missing'; end if;
end $$;
commit;
