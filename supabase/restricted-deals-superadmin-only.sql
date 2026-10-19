-- Only a super_admin may mark a deal private or lift it. Owners/agents/other admins cannot, on insert or update.
-- (service_role / server code has auth.uid() null and is unaffected.)
-- Supersedes the owner-may-flip rule in restricted-deals-follow.sql.
create or replace function public.crm_deals_guard_restricted()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.crm_is_super_admin() and new.is_restricted is distinct from old.is_restricted then
    new.is_restricted := old.is_restricted;
  end if;
  return new;
end $$;

-- On insert, a non-super_admin cannot create a deal as private; the auto-restrict trigger
-- still flags deals owned by a super_admin.
create or replace function public.crm_deals_guard_restricted_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.crm_is_super_admin() then
    new.is_restricted := false;
  end if;
  return new;
end $$;
drop trigger if exists aa_crm_deals_guard_restricted_insert on public.crm_deals;
create trigger aa_crm_deals_guard_restricted_insert before insert on public.crm_deals
  for each row execute function public.crm_deals_guard_restricted_insert();
