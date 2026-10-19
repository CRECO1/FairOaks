-- Restricted deals: a deal flagged is_restricted is visible only to its owning
-- agent (agent_id), agents in assigned_agent_ids, and super_admin. Other admins
-- no longer see it unless added to the deal as an assigned agent.
--
-- New deals owned by a super_admin (Zack) are restricted automatically; existing
-- deals are untouched (is_restricted defaults false), except where flipped by hand.

alter table public.crm_deals add column if not exists is_restricted boolean not null default false;

create or replace function public.crm_deal_visible(restricted boolean, owner uuid, assigned uuid[])
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce(restricted, false)
      or public.crm_is_super_admin()
      or owner = auth.uid()
      or auth.uid() = any (coalesce(assigned, '{}'::uuid[]));
$$;

create or replace function public.crm_deals_auto_restrict()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.agent_id is not null and exists (select 1 from public.crm_profiles where id = new.agent_id and role = 'super_admin') then
    new.is_restricted := true;
  end if;
  return new;
end $$;
drop trigger if exists crm_deals_auto_restrict on public.crm_deals;
create trigger crm_deals_auto_restrict before insert on public.crm_deals
  for each row execute function public.crm_deals_auto_restrict();

drop policy if exists "deals_scoped_select" on public.crm_deals;
create policy "deals_scoped_select" on public.crm_deals for select to authenticated
  using (
    public.crm_deal_visible(is_restricted, agent_id, assigned_agent_ids)
    and (
      (select public.crm_is_admin())
      or (business_unit = (select public.crm_current_bu())
          and (not (select public.crm_is_agent()) or agent_id = (select auth.uid()) or (select auth.uid()) = any (coalesce(assigned_agent_ids, '{}'::uuid[]))))
    )
  );

drop policy if exists "deals_scoped_update" on public.crm_deals;
create policy "deals_scoped_update" on public.crm_deals for update to authenticated
  using (
    public.crm_deal_visible(is_restricted, agent_id, assigned_agent_ids)
    and (
      (select public.crm_is_admin())
      or (business_unit = (select public.crm_current_bu())
          and (not (select public.crm_is_agent()) or agent_id = (select auth.uid()) or (select auth.uid()) = any (coalesce(assigned_agent_ids, '{}'::uuid[]))))
    )
  )
  with check (
    public.crm_deal_visible(is_restricted, agent_id, assigned_agent_ids)
    and (
      (select public.crm_is_admin())
      or (business_unit = (select public.crm_current_bu())
          and (not (select public.crm_is_agent()) or agent_id = (select auth.uid()) or (select auth.uid()) = any (coalesce(assigned_agent_ids, '{}'::uuid[]))))
    )
  );

drop policy if exists "deals_admin_delete" on public.crm_deals;
create policy "deals_admin_delete" on public.crm_deals for delete to authenticated
  using ((select public.crm_is_admin()) and public.crm_deal_visible(is_restricted, agent_id, assigned_agent_ids));

-- The Blanco Plaza deal (Diana Findley, 6609 Blanco Rd.)
update public.crm_deals set is_restricted = true where id = '976b310a-b153-4808-919d-6caf92baa5eb';
