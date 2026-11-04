-- Security hardening, 2026-11-03 audit. Idempotent; run in one transaction.
--
-- 1. crm_deal_emails: three legacy permissive policies still let ANY profile holder (either workspace) read / write
--    every email that is linked to a contact but not to a deal. deal_emails_unit_scoped already covers every legitimate case.
-- 2. site_admin_ok() was true for ANY CRM profile holder, so any agent could read / edit / delete every website lead,
--    add themselves to admin_users, edit listings / agents / site settings and delete images. It now means: an admin or
--    super_admin, or someone listed in admin_users. Website leads + admin_users are narrower still: super_admin (or an
--    admin_users entry) only.
-- 3. crm_blocked_numbers: agents could insert / delete blocks straight through the database, bypassing the API's admin
--    rule. Writes are server-only now (the API uses the service role); reads are limited to the caller's workspace.
-- 4. crm_note_history (929 rows of previous note text): readable by every profile holder in both workspaces. Server-only.
-- 5. crm_property_tenants / crm_property_history: rent-roll data readable + writable by every profile holder through the
--    database; the app only touches them through service-role API routes (which do their own workspace checks). Server-only.
-- 6. crm_notifications: any agent could insert a notification (arbitrary text) into ANY user's bell, including other
--    workspaces and the owner. Inserts must now come from yourself, to someone in your workspace (admins: anyone).
-- 7. receipts bucket: admin-only (nothing in the app uses it for agents).
-- 8. email-attachments bucket: 25 MB cap.
-- 9. plaza-resumes anon upload: real UUID shape.
-- 10. TRUNCATE / REFERENCES / TRIGGER grants removed for anon + authenticated on every table, including tables created
--     after the October pass, and removed from the defaults for future tables.
-- 11. Listing agents' phone numbers (third-party MLS agents) are no longer stored; existing values cleared.
--
-- Rollback notes are at the bottom.

begin;

-- 1 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "See emails for accessible deals or clients"    on public.crm_deal_emails;
drop policy if exists "Insert emails for accessible deals or clients" on public.crm_deal_emails;
drop policy if exists "Update emails for accessible deals or clients" on public.crm_deal_emails;
drop policy if exists "crm_deal_emails unit access"                   on public.crm_deal_emails;

-- 2 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.site_admin_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_is_admin(), false)
      or exists (select 1 from public.admin_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.site_owner_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.crm_is_super_admin(), false)
      or exists (select 1 from public.admin_users where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
$$;
revoke all on function public.site_owner_ok() from public, anon;
grant execute on function public.site_owner_ok() to authenticated, service_role;

alter policy "Auth read leads"   on public.leads using (public.site_owner_ok());
alter policy "Auth update leads" on public.leads using (public.site_owner_ok()) with check (public.site_owner_ok());
alter policy "Auth delete leads" on public.leads using (public.site_owner_ok());
alter policy "Auth insert leads" on public.leads with check (public.site_owner_ok());

alter policy "Auth read admin_users"  on public.admin_users using (public.crm_is_super_admin());
alter policy "Auth write admin_users" on public.admin_users using (public.crm_is_super_admin()) with check (public.crm_is_super_admin());

-- 3 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists crm_blocked_numbers_staff_insert on public.crm_blocked_numbers;
drop policy if exists crm_blocked_numbers_staff_delete on public.crm_blocked_numbers;
revoke insert, delete, update on public.crm_blocked_numbers from authenticated;
drop policy if exists crm_blocked_numbers_staff_read on public.crm_blocked_numbers;
create policy crm_blocked_numbers_staff_read on public.crm_blocked_numbers
  for select to authenticated
  using (public.crm_is_admin() or business_unit in ('all', public.crm_current_bu()));

-- 4 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists note_history_read on public.crm_note_history;

-- 5 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists "crm_property_tenants authenticated" on public.crm_property_tenants;
drop policy if exists "crm_property_history authenticated" on public.crm_property_history;
revoke all on public.crm_property_tenants, public.crm_property_history from anon, authenticated;

-- 6 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists authenticated_insert_notifications on public.crm_notifications;
create policy authenticated_insert_notifications on public.crm_notifications
  for insert to authenticated
  with check (
    public.crm_has_profile()
    and sender_id = (select auth.uid())
    and (
      public.crm_is_admin()
      or exists (select 1 from public.crm_profiles r where r.id = recipient_id and r.business_unit = public.crm_current_bu())
    )
  );

-- 7 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
alter policy "auth read receipts"   on storage.objects using (bucket_id = 'receipts' and public.crm_is_admin());
alter policy "auth update receipts" on storage.objects using (bucket_id = 'receipts' and public.crm_is_admin());
alter policy "auth delete receipts" on storage.objects using (bucket_id = 'receipts' and public.crm_is_admin());
alter policy "auth upload receipts" on storage.objects with check (bucket_id = 'receipts' and public.crm_is_admin());

-- 8 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
update storage.buckets set file_size_limit = 26214400 where id = 'email-attachments' and file_size_limit is null;

-- 9 ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy if exists plaza_resumes_anon_insert on storage.objects;
create policy plaza_resumes_anon_insert on storage.objects
  for insert to anon
  with check (bucket_id = 'plaza-resumes'
    and name ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/[A-Za-z0-9._-]{1,100}$');

-- 10 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from anon;

-- 11 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
update public.listings set list_agent_phone = null, list_agent_email = null
 where list_agent_phone is not null or list_agent_email is not null;

commit;

-- Rollback (if something unexpected breaks):
--   site_admin_ok: re-create as  select public.crm_has_profile() or exists (select 1 from public.admin_users where lower(email)=lower(coalesce(auth.jwt()->>'email','')))
--   policies: re-create from supabase/security-lockdown-2026-10.sql, 20261022_call_blocklist.sql, deal-emails-agent-scope-2026-11.sql
