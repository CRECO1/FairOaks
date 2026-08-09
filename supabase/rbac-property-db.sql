-- ============================================================================
-- Property DB delete lock (applied live 2026-08-09 via pooler).
-- Mirrors crm_clients: an `admin` can view/work the Property DB but only a
-- `super_admin` can delete rows — even from a direct browser DB call. The
-- broker-ingest pipeline + bulk imports use the service role (bypasses RLS).
-- Depends on public.crm_is_super_admin() from rbac-super-admin.sql.
-- ============================================================================
alter table public.crm_prospective_properties enable row level security;

drop policy if exists "prospective_properties select" on public.crm_prospective_properties;
create policy "prospective_properties select"
  on public.crm_prospective_properties for select to authenticated using (true);

do $mig$
declare pol record;
begin
  for pol in select policyname from pg_policies
    where schemaname='public' and tablename='crm_prospective_properties' and cmd='DELETE'
  loop execute format('drop policy %I on public.crm_prospective_properties', pol.policyname); end loop;
end $mig$;

create policy "prospective_properties delete super admin only"
  on public.crm_prospective_properties for delete to authenticated
  using (public.crm_is_super_admin());

-- INSERT/UPDATE intentionally have no authenticated policy (service-role only).
