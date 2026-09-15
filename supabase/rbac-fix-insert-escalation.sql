-- ============================================================================
-- Close the self-serve super_admin escalation on crm_profiles.
--
-- The hole: the "Service can insert profiles" policy applied to every
-- authenticated user with `with check (auth.uid() = id)` and NO restriction on
-- the `role` column, and the crm_profiles role-guard trigger fired only on
-- UPDATE/DELETE — not INSERT. So any signed-in user without a profile yet could
-- INSERT their own crm_profiles row with role = 'super_admin' and escalate.
-- (UPDATE escalation was already blocked by the trigger; only INSERT was open.)
--
-- Fix, in two layers:
--   1. A self-insert may ONLY create role = 'agent'. Elevation to admin /
--      super_admin happens exclusively through a trusted server route (service
--      role, which bypasses RLS) or an existing super_admin — never by a user
--      inserting their own row.
--   2. The role-guard trigger now also fires BEFORE INSERT (defense-in-depth),
--      so even a future/looser insert policy can't smuggle in an elevated role.
--
-- Idempotent — safe to re-run. Run in the Supabase SQL editor or via the pooler.
-- ============================================================================

-- 1. Replace the permissive insert policy with an agent-only self-insert.
drop policy if exists "Service can insert profiles" on public.crm_profiles;
drop policy if exists "crm_profiles self-insert as agent only" on public.crm_profiles;
create policy "crm_profiles self-insert as agent only"
  on public.crm_profiles
  for insert to authenticated
  with check (auth.uid() = id and role = 'agent');

-- 2. Extend the role-guard trigger to cover INSERT.
create or replace function public.crm_guard_profile_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- service role / trusted server context: routes enforce their own rules
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    -- A user creating their own profile can only ever be an agent; anything
    -- higher must come from a trusted server route or an existing super admin.
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
  elsif tg_op = 'DELETE' then
    if old.role in ('admin', 'super_admin') and not public.crm_is_super_admin() then
      raise exception 'Only a super admin can remove an admin';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists crm_profiles_role_guard on public.crm_profiles;
create trigger crm_profiles_role_guard
  before insert or update or delete on public.crm_profiles
  for each row execute function public.crm_guard_profile_change();

-- Verify:
--   select policyname, with_check from pg_policies where tablename='crm_profiles' and cmd='INSERT';
--   select tgname, (tgtype&4)>0 as on_insert from pg_trigger where tgrelid='public.crm_profiles'::regclass and not tgisinternal;
