-- 2-step verification at the database (2026-11-05).
--
-- The CRM API already refuses a password-only (aal1) token for any login that has a verified authenticator factor. This closes the other
-- door: the browser can also talk to Supabase directly under row-level security, so the same rule is added there as a RESTRICTIVE policy
-- (it is AND-ed with every existing policy and can only take access away, never add it).
--
-- A login WITHOUT a verified factor is unaffected. A login with one needs an aal2 token (password + code) to read or write anything.
-- Service-role (server) access bypasses RLS and is unaffected. Rollback: see the bottom of this file.

create or replace function public.crm_mfa_ok() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = (select auth.uid()) and f.status = 'verified')
$$;
revoke all on function public.crm_mfa_ok() from public, anon;
grant execute on function public.crm_mfa_ok() to authenticated;

do $$
declare t text;
begin
  for t in
    select distinct p.tablename from pg_policies p
    where p.schemaname = 'public' and (p.roles && array['authenticated','public']::name[])
  loop
    execute format('drop policy if exists crm_mfa_required on public.%I', t);
    execute format('create policy crm_mfa_required on public.%I as restrictive for all to authenticated using ((select public.crm_mfa_ok())) with check ((select public.crm_mfa_ok()))', t);
  end loop;
end $$;

-- Drive document / form live-collaboration channels (Realtime broadcast)
drop policy if exists crm_mfa_required_rt on realtime.messages;
create policy crm_mfa_required_rt on realtime.messages as restrictive for all to authenticated using ((select public.crm_mfa_ok())) with check ((select public.crm_mfa_ok()));

-- ROLLBACK:
--   do $$ declare t text; begin for t in select tablename from pg_policies where schemaname='public' and policyname='crm_mfa_required' loop execute format('drop policy crm_mfa_required on public.%I', t); end loop; end $$;
--   drop policy if exists crm_mfa_required_rt on realtime.messages;
--   drop function if exists public.crm_mfa_ok();
