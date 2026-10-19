-- Everything attached to a restricted deal follows the deal.
-- Companion to restricted-deals.sql (must be applied first).
--
-- RESTRICTIVE policies AND with the existing permissive ones, so a private deal's
-- emails, docs, forms, envelopes, meetings, tasks and call log are hidden from
-- anyone who can't see the deal itself. service_role (server routes) bypasses RLS
-- and is handled in app code.
create or replace function public.crm_deal_id_visible(p_deal uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_deal is null or not exists (
    select 1 from public.crm_deals d
    where d.id = p_deal
      and coalesce(d.is_restricted, false)
      and not (public.crm_is_super_admin() or d.agent_id = auth.uid()
               or auth.uid() = any (coalesce(d.assigned_agent_ids, '{}'::uuid[])))
  );
$$;

do $$
declare t text;
begin
  foreach t in array array['crm_deal_emails','crm_deal_docs','crm_docs','crm_deal_forms','crm_deal_meetings',
                           'crm_form_submissions','crm_envelopes','crm_tasks','crm_call_log'] loop
    execute format('drop policy if exists "restricted_deal_follow" on public.%I', t);
    execute format('create policy "restricted_deal_follow" on public.%I as restrictive for all to authenticated using (public.crm_deal_id_visible(deal_id)) with check (public.crm_deal_id_visible(deal_id))', t);
  end loop;
end $$;

-- Only the deal's owner (or super_admin) may change the private flag.
create or replace function public.crm_deals_guard_restricted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.crm_is_super_admin() and auth.uid() is distinct from old.agent_id
     and new.is_restricted is distinct from old.is_restricted then
    new.is_restricted := old.is_restricted;
  end if;
  return new;
end $$;
drop trigger if exists crm_deals_guard_restricted on public.crm_deals;
create trigger crm_deals_guard_restricted before update on public.crm_deals
  for each row execute function public.crm_deals_guard_restricted();
