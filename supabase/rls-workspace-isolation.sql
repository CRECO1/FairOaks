-- ============================================================================
-- Workspace + agent data isolation via Row-Level Security   (fixes audit P0-1)
-- Project: bnqdzgypesoythpbeujk  ·  Run in the Supabase SQL editor.
--
-- WHY: The browser talks to several crm_* tables directly with the *publishable*
-- key using each user's own session. Today those tables have little or no RLS, so
-- any authenticated user can read/modify rows across BOTH Fair Oaks (residential)
-- and CRECO (commercial). Trusted server routes use the *service-role* key, which
-- bypasses RLS, so these policies do NOT affect the API routes — they only add the
-- missing database-level guard for the direct browser reads/writes.
--
-- ⚠️ APPLY DELIBERATELY — DO NOT PASTE BLINDLY INTO PROD.
--   1. Run the VERIFY block at the bottom FIRST to confirm column names
--      (business_unit / client_id / deal_id / campaign_id) match your live schema.
--   2. Apply on a staging copy (or during a quiet window) and click through the CRM
--      as a NON-admin agent: contacts, deals, tasks, timelines, campaigns.
--   3. Tightening RLS can surface reads the UI relied on — fix by scoping, never by
--      dropping the policy. A rollback block is provided at the end.
--
-- Idempotent: safe to re-run. Model: agents see only their own business_unit;
-- admins and super_admins see everything.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Helper functions (security definer so they bypass RLS while resolving the
--    caller's own unit/role — avoids infinite recursion on crm_profiles).
-- ---------------------------------------------------------------------------
create or replace function public.crm_current_bu()
returns text language sql stable security definer set search_path = public as $$
  select business_unit from public.crm_profiles where id = auth.uid();
$$;

create or replace function public.crm_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_profiles
    where id = auth.uid() and role in ('admin', 'super_admin')
  );
$$;
-- (public.crm_is_super_admin() is created by rbac-super-admin.sql)

-- ---------------------------------------------------------------------------
-- 1. Tables that carry business_unit directly.
--    Agents: their unit only. Admins/super-admins: all.
--    NOTE: the existing "crm_clients delete super admin only" DELETE policy and the
--    crm_profiles role-guard trigger from rbac-super-admin.sql remain in force and
--    compose with these (RLS policies are OR-ed per command).
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'crm_clients', 'crm_deals', 'crm_tasks', 'crm_commissions',
    'crm_campaigns', 'crm_action_plans'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I on public.%I;', t || ' unit read',  t);
    execute format('drop policy if exists %I on public.%I;', t || ' unit write', t);

    -- Read: same unit or admin
    execute format($f$
      create policy %I on public.%I
        for select to authenticated
        using (public.crm_is_admin() or business_unit = public.crm_current_bu());
    $f$, t || ' unit read', t);

    -- Insert/Update: same unit or admin (DELETE is left to existing/explicit policies)
    execute format($f$
      create policy %I on public.%I
        for update to authenticated
        using (public.crm_is_admin() or business_unit = public.crm_current_bu())
        with check (public.crm_is_admin() or business_unit = public.crm_current_bu());
    $f$, t || ' unit write', t);
  end loop;
end $$;

-- Inserts from the browser (e.g. new client/deal/task) — allow only into own unit.
do $$
declare t text;
begin
  foreach t in array array['crm_clients','crm_deals','crm_tasks','crm_commissions','crm_campaigns','crm_action_plans'] loop
    execute format('drop policy if exists %I on public.%I;', t || ' unit insert', t);
    execute format($f$
      create policy %I on public.%I
        for insert to authenticated
        with check (public.crm_is_admin() or business_unit = public.crm_current_bu());
    $f$, t || ' unit insert', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. crm_profiles: readable within-unit (for assignee names) + self + admins.
--    Writes go through service-role routes, so no authenticated write policy is
--    needed; the role-escalation trigger from rbac-super-admin.sql still applies.
-- ---------------------------------------------------------------------------
alter table public.crm_profiles enable row level security;
drop policy if exists "crm_profiles unit read" on public.crm_profiles;
create policy "crm_profiles unit read" on public.crm_profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.crm_is_admin()
    or business_unit = public.crm_current_bu()
  );

-- ---------------------------------------------------------------------------
-- 3. Child tables — scope through their parent's business_unit via EXISTS.
--    (Adjust the linking column if your schema differs — see VERIFY block.)
-- ---------------------------------------------------------------------------

-- crm_deal_emails → deal or client in caller's unit
alter table public.crm_deal_emails enable row level security;
drop policy if exists "crm_deal_emails unit access" on public.crm_deal_emails;
create policy "crm_deal_emails unit access" on public.crm_deal_emails
  for all to authenticated
  using (
    public.crm_is_admin()
    or exists (select 1 from public.crm_deals d   where d.id = crm_deal_emails.deal_id     and d.business_unit = public.crm_current_bu())
    or exists (select 1 from public.crm_clients c where c.id = crm_deal_emails.client_id    and c.business_unit = public.crm_current_bu())
  )
  with check (
    public.crm_is_admin()
    or exists (select 1 from public.crm_deals d   where d.id = crm_deal_emails.deal_id     and d.business_unit = public.crm_current_bu())
    or exists (select 1 from public.crm_clients c where c.id = crm_deal_emails.client_id    and c.business_unit = public.crm_current_bu())
  );

-- crm_client_activities → client in caller's unit
alter table public.crm_client_activities enable row level security;
drop policy if exists "crm_client_activities unit access" on public.crm_client_activities;
create policy "crm_client_activities unit access" on public.crm_client_activities
  for all to authenticated
  using (
    public.crm_is_admin()
    or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = public.crm_current_bu())
  )
  with check (
    public.crm_is_admin()
    or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = public.crm_current_bu())
  );

-- crm_activity → client in caller's unit
alter table public.crm_activity enable row level security;
drop policy if exists "crm_activity unit access" on public.crm_activity;
create policy "crm_activity unit access" on public.crm_activity
  for all to authenticated
  using (
    public.crm_is_admin()
    or exists (select 1 from public.crm_clients c where c.id = crm_activity.client_id and c.business_unit = public.crm_current_bu())
  )
  with check (
    public.crm_is_admin()
    or exists (select 1 from public.crm_clients c where c.id = crm_activity.client_id and c.business_unit = public.crm_current_bu())
  );

-- crm_campaign_sends → campaign in caller's unit
alter table public.crm_campaign_sends enable row level security;
drop policy if exists "crm_campaign_sends unit access" on public.crm_campaign_sends;
create policy "crm_campaign_sends unit access" on public.crm_campaign_sends
  for all to authenticated
  using (
    public.crm_is_admin()
    or exists (select 1 from public.crm_campaigns k where k.id = crm_campaign_sends.campaign_id and k.business_unit = public.crm_current_bu())
  )
  with check (
    public.crm_is_admin()
    or exists (select 1 from public.crm_campaigns k where k.id = crm_campaign_sends.campaign_id and k.business_unit = public.crm_current_bu())
  );

-- ---------------------------------------------------------------------------
-- 4. Replace the wide-open property-DB policies (were: using(true)).
--    These are shared prospecting data — keep them readable to any authenticated
--    CRM user, but drop write access down to admins (tenants/history are curated).
--    If agents must edit tenants/history, swap crm_is_admin() for a unit check.
-- ---------------------------------------------------------------------------
drop policy if exists "crm_property_tenants authenticated" on public.crm_property_tenants;
create policy "crm_property_tenants read"  on public.crm_property_tenants
  for select to authenticated using (true);
create policy "crm_property_tenants write" on public.crm_property_tenants
  for all to authenticated using (public.crm_is_admin()) with check (public.crm_is_admin());

drop policy if exists "crm_property_history authenticated" on public.crm_property_history;
create policy "crm_property_history read"  on public.crm_property_history
  for select to authenticated using (true);
create policy "crm_property_history write" on public.crm_property_history
  for all to authenticated using (public.crm_is_admin()) with check (public.crm_is_admin());

commit;

-- ============================================================================
-- VERIFY — run these SELECTs (read-only) BEFORE and AFTER applying.
-- ============================================================================
-- 1) Confirm the linking columns actually exist with these names:
--    select table_name, column_name from information_schema.columns
--    where table_schema='public'
--      and table_name in ('crm_deal_emails','crm_client_activities','crm_activity','crm_campaign_sends')
--      and column_name in ('deal_id','client_id','campaign_id')
--    order by table_name, column_name;
--
-- 2) Confirm RLS is now on and list policies:
--    select tablename, rowsecurity from pg_tables
--      where schemaname='public' and tablename like 'crm_%' order by tablename;
--    select tablename, policyname, cmd from pg_policies
--      where schemaname='public' order by tablename, cmd;
--
-- 3) Smoke test as a real agent session (not service role): sign in as a commercial
--    agent and confirm a residential client id returns 0 rows, and vice-versa.
--
-- ============================================================================
-- ROLLBACK (if the UI breaks and you need to revert quickly):
--   Disable RLS on a table:  alter table public.<t> disable row level security;
--   Or drop a single policy:  drop policy "<name>" on public.<t>;
-- Re-enable once the scoping is corrected — do not leave these tables without RLS.
-- ============================================================================
