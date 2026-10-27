-- Owner privacy, Oct 2026 (Zack): Brian is an admin, so he sees everything not flagged private. Two gaps:
--
-- 1) Deals the broker alone is on. restricted-deals.sql flags a deal private only when it is CREATED with a
--    super_admin owner, so older deals owned by the broker were visible to every admin. Flag them now.
--    A deal with another agent assigned stays visible to that agent (crm_deal_visible() lets assigned agents in).
--    Idempotent: only touches deals not already private, owned by a super_admin, with no non-super_admin assigned.
--
-- 2) "🔔 Website: …" / "🌙 Website (after hours): …" timeline notes — the record that a contact was on the site.
--    The app now hides them from everyone but the account owner; this makes the database enforce the same.
--    (site_pageviews / site_events / site_visitor_links / site_contact_alerts are already RLS-on with no policies.)

update public.crm_deals d
   set is_restricted = true
 where not coalesce(d.is_restricted, false)
   and exists (select 1 from public.crm_profiles o where o.id = d.agent_id and o.role = 'super_admin')
   and not exists (
         select 1 from unnest(coalesce(d.assigned_agent_ids, '{}'::uuid[])) a(id)
           join public.crm_profiles p on p.id = a.id
          where p.role <> 'super_admin');

-- 1b) Only the broker (super_admin) may hold a private deal. A private deal whose owner is anyone else — e.g. one the
--     broker hands to an agent — is made ordinary, for every writer (including server code, which bypasses the guards in
--     restricted-deals-superadmin-only.sql). Named zz_ so it fires after the other deal triggers.
update public.crm_deals d set is_restricted = false
 where d.is_restricted
   and not exists (select 1 from public.crm_profiles o where o.id = d.agent_id and o.role = 'super_admin');

create or replace function public.crm_deals_private_only_broker()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_restricted and not exists (select 1 from public.crm_profiles o where o.id = new.agent_id and o.role = 'super_admin') then
    new.is_restricted := false;
  end if;
  return new;
end $$;
drop trigger if exists zz_crm_deals_private_only_broker on public.crm_deals;
create trigger zz_crm_deals_private_only_broker before insert or update on public.crm_deals
  for each row execute function public.crm_deals_private_only_broker();

drop policy if exists visitor_notes_owner_only on public.crm_activity;
create policy visitor_notes_owner_only on public.crm_activity as restrictive for select to authenticated
  using (
    (select public.crm_is_super_admin())
    or notes is null
    or (notes not like '🔔 Website:%' and notes not like '🌙 Website (after hours)%')
  );
