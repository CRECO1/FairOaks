-- ============================================================================
-- Super-admin RBAC hardening for the CRECO / Fair Oaks CRM
-- Run this in the Supabase SQL editor (project bnqdzgypesoythpbeujk).
--
-- Goal (insider-offboarding threat model): an `admin` (Brian) keeps agent
-- management, contact editing, and agent-to-contact assignment, but CANNOT
-- delete contacts, change roles, or remove/demote the super admin — even by
-- calling the database directly from the browser. Only a `super_admin` (Zack)
-- can delete contacts and manage admins.
--
-- These rules bind the CLIENT-SIDE Supabase calls the app makes with each
-- user's own session. Trusted server routes use the service-role key, which
-- bypasses RLS; the guards below intentionally skip enforcement for the
-- service role (auth.uid() IS NULL) since those routes do their own checks.
-- ============================================================================

-- 1. Helper: is the current (JWT) user a super_admin?
create or replace function public.crm_is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_profiles
    where id = auth.uid() and role = 'super_admin'
  );
$$;

-- 2. crm_clients: DELETE is super-admin only.
--    Drop any existing DELETE policies (unknown names) and replace them, so a
--    lingering "admins can delete" policy can't OR its way back in.
alter table public.crm_clients enable row level security;
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'crm_clients' and cmd = 'DELETE'
  loop
    execute format('drop policy %I on public.crm_clients', pol.policyname);
  end loop;
end $$;

create policy "crm_clients delete super admin only"
  on public.crm_clients
  for delete to authenticated
  using (public.crm_is_super_admin());

-- 3. crm_profiles: guard role escalation + super-admin tampering.
--    A trigger (not RLS) because we must compare OLD.role vs NEW.role.
--    Enforced only for real user sessions (auth.uid() IS NOT NULL); the
--    service role (server routes) is trusted and passes through.
create or replace function public.crm_guard_profile_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    -- service role / trusted server context: allow (routes enforce their own rules)
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' then
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
  before update or delete on public.crm_profiles
  for each row execute function public.crm_guard_profile_change();

-- 4a. Widen the role CHECK constraint to allow the new super_admin tier.
alter table public.crm_profiles drop constraint if exists crm_profiles_role_check;
alter table public.crm_profiles add constraint crm_profiles_role_check
  check (role = any (array['admin', 'agent', 'super_admin']));

-- 4b. Promote Zack to super_admin. (Safe now — the app treats super_admin as a
--     superset of admin, and the updated frontend is deployed.)
update public.crm_profiles
  set role = 'super_admin'
  where email = 'info@fairoaksrealtygroup.com';

-- Verify:
--   select email, role from public.crm_profiles order by role;
