-- crm_profiles RLS hardening (2026-09-28). Closes two holes found in an audit:
--
-- 1. SELECT was wide open. A policy "Authenticated users can read all profiles"
--    (USING auth.uid() IS NOT NULL) let any signed-in user read EVERY profile across
--    both workspaces (names, emails, roles). It sat next to the correctly-scoped
--    policy, and Postgres OR's permissive policies, so the open one won. Replaced with
--    a single scoped SELECT policy that matches exactly what the app queries: your own
--    row, every admin/super-admin, and same-workspace profiles (admins keep full
--    visibility via crm_is_admin()).
--
-- 2. A user could change their own business_unit. The role-guard trigger blocked role
--    escalation but not a self business_unit change — flipping it would hand the user
--    the OTHER workspace's data (RLS scopes by crm_current_bu()). The guard now also
--    blocks a non-admin from changing business_unit. Role escalation was already
--    blocked and stays blocked; legitimate self-edits (name, phone, signature) still work.

drop policy if exists "Authenticated users can read all profiles" on public.crm_profiles;

drop policy if exists profiles_unit_select on public.crm_profiles;
create policy profiles_unit_select on public.crm_profiles for select
  using (
    id = auth.uid()
    or public.crm_is_admin()
    or business_unit = public.crm_current_bu()
    or role in ('admin','super_admin')
  );

create or replace function public.crm_guard_profile_change() returns trigger
  language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    -- service role / trusted server context: routes enforce their own rules
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'INSERT' then
    if new.role is distinct from 'agent' and not public.crm_is_super_admin() then
      raise exception 'A self-created profile must be an agent — role elevation is done by a super admin';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.role is distinct from old.role and not public.crm_is_super_admin() then
      raise exception 'Only a super admin can change a user''s role';
    end if;
    if old.role = 'super_admin' and not public.crm_is_super_admin() then
      raise exception 'Only a super admin can modify a super-admin profile';
    end if;
    if new.business_unit is distinct from old.business_unit and not public.crm_is_admin() then
      raise exception 'Only an admin can change a user''s workspace';
    end if;
  elsif tg_op = 'DELETE' then
    if old.role in ('admin', 'super_admin') and not public.crm_is_super_admin() then
      raise exception 'Only a super admin can remove an admin';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
