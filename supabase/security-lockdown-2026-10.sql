-- STATUS: dry-run tested 2026-10-07 (simulated logins: owner, agent, allow-listed admin, stranger); applied on owner's go-ahead.
-- Security lockdown (audit 2026-10-07).
-- Problem: Supabase Auth signups are open, and many RLS policies only checked "is logged in"
-- (auth.role()='authenticated' / auth.uid() is not null / true). Any stranger who signed up could
-- read the Property DB, rent roll, note history and synced client emails, write website content,
-- and self-create a Commercial agent profile.
-- Fix: a real CRM profile is required everywhere; the legacy site /admin portal keeps working for
-- explicitly allow-listed emails (admin_users); self-created profiles only for INVITED users.
-- Idempotent. Run with the service role / postgres.

create or replace function public.crm_has_profile() returns boolean
  language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.crm_profiles where id = auth.uid()) $$;

create or replace function public.crm_user_invited() returns boolean
  language sql stable security definer set search_path = public, auth as
$$ select coalesce((select invited_at is not null from auth.users where id = auth.uid()), false) $$;

create or replace function public.site_admin_ok() returns boolean
  language sql stable security definer set search_path = public as
$$ select public.crm_has_profile()
       or exists (select 1 from public.admin_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;

grant execute on function public.crm_has_profile(), public.crm_user_invited(), public.site_admin_ok() to anon, authenticated;

-- Keep the legacy /admin portal login that already had access (lisa@) working.
insert into public.admin_users (email, name, role)
select 'lisa@fairoaksrealtygroup.com', 'Lisa', 'agent'
where not exists (select 1 from public.admin_users where lower(email) = 'lisa@fairoaksrealtygroup.com');

-- ── Website-content tables: profile holders or allow-listed admins only ─────────────────────────
do $$
declare r record; newq text; newc text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where schemaname = 'public'
      and tablename in ('admin_users','agents','leads','listings','neighborhoods','site_settings','testimonials')
      and (coalesce(qual,'') ilike '%auth.role()%' or coalesce(with_check,'') ilike '%auth.role()%')
  loop
    execute format('alter policy %I on %I.%I %s %s', r.policyname, r.schemaname, r.tablename,
      case when r.qual is not null then 'using (public.site_admin_ok())' else '' end,
      case when r.with_check is not null then 'with check (public.site_admin_ok())' else '' end);
  end loop;
end $$;

-- ── CRM tables: a CRM profile is required ───────────────────────────────────────────────────────
alter policy "crm_campaign_projects authenticated" on public.crm_campaign_projects using (public.crm_has_profile()) with check (public.crm_has_profile());
alter policy "crm_property_history authenticated" on public.crm_property_history using (public.crm_has_profile()) with check (public.crm_has_profile());
alter policy "crm_property_tenants authenticated" on public.crm_property_tenants using (public.crm_has_profile()) with check (public.crm_has_profile());
alter policy office_suites_rw on public.office_suites using (public.crm_has_profile()) with check (public.crm_has_profile());
alter policy "prospective_properties select" on public.crm_prospective_properties using (public.crm_has_profile());
alter policy crm_docs_read on public.crm_docs using (public.crm_has_profile());
alter policy note_history_read on public.crm_note_history using (public.crm_has_profile());
alter policy crm_outside_agents_insert on public.crm_outside_agents with check (public.crm_has_profile());
alter policy authenticated_insert_notifications on public.crm_notifications with check (public.crm_has_profile());

-- The legacy deal-email policies are OR'd with the BU-scoped one, so their "client_id not null and
-- logged in" branch defeated it. Require a profile on top of whatever they already check.
do $$
declare r record;
begin
  for r in select policyname, qual, with_check from pg_policies
           where schemaname='public' and tablename='crm_deal_emails' and policyname like '% emails for accessible deals or clients'
  loop
    execute format('alter policy %I on public.crm_deal_emails %s %s', r.policyname,
      case when r.qual is not null then format('using (public.crm_has_profile() and (%s))', r.qual) else '' end,
      case when r.with_check is not null then format('with check (public.crm_has_profile() and (%s))', r.with_check) else '' end);
  end loop;
end $$;

-- ── Storage ─────────────────────────────────────────────────────────────────────────────────────
alter policy "Auth upload images" on storage.objects with check (bucket_id = 'images' and public.site_admin_ok());
alter policy "Auth delete images" on storage.objects using (bucket_id = 'images' and public.site_admin_ok());
alter policy "auth read receipts" on storage.objects using (bucket_id = 'receipts' and public.crm_has_profile());
alter policy "auth upload receipts" on storage.objects with check (bucket_id = 'receipts' and public.crm_has_profile());
alter policy "auth update receipts" on storage.objects using (bucket_id = 'receipts' and public.crm_has_profile()) with check (bucket_id = 'receipts' and public.crm_has_profile());
alter policy "auth delete receipts" on storage.objects using (bucket_id = 'receipts' and public.crm_has_profile());

-- ── Profiles: only INVITED users may create their own (agent-only) profile ───────────────────────
alter policy "crm_profiles self-insert as agent only" on public.crm_profiles
  with check (auth.uid() = id and role = 'agent' and public.crm_user_invited() and business_unit in ('commercial','residential'));

-- Profile directory: the "role is admin/super_admin" branch let ANY logged-in user (incl. a stranger who
-- just signed up) read the admin profile rows. Require a profile of your own on top of the old rule.
do $$
declare q text;
begin
  select pg_get_expr(polqual, polrelid) into q from pg_policy
   where polrelid = 'public.crm_profiles'::regclass and polname = 'profiles_unit_select';
  if q is not null and q not like '%crm_has_profile%' then
    execute format('alter policy profiles_unit_select on public.crm_profiles using (id = auth.uid() or (public.crm_has_profile() and (%s)))', q);
  end if;
end $$;
