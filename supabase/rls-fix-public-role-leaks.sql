-- ============================================================================
-- Close RLS policies that were granted to the `public` role   (audit C1, C2)
-- Project: bnqdzgypesoythpbeujk
--
-- WHY: several policies were written as
--        create policy "service role full access" on <t> for all using (true);
--      With no `to` clause Postgres defaults the grantee to the `public` ROLE,
--      which INCLUDES `anon` — the publishable key that ships in the browser
--      bundle. The service role never needed a policy in the first place: it is
--      BYPASSRLS, so it is unaffected by every statement in this file.
--
-- Verified live before this change (anon/publishable key, production):
--        GET /rest/v1/crm_tasks              -> 206, 70 rows  (client names,
--                                               lease-expiry notes, agent ids)
--        GET /rest/v1/crm_campaign_projects  -> 200,  8 rows  (deal strategy)
--      Both `for all ... using (true)`, so anon could also INSERT/UPDATE/DELETE.
--
-- Each drop below is additive-only: permissive policies are OR-ed, so removing
-- an over-broad one cannot revoke access that another policy already grants.
-- The API routes use the service-role key and are unaffected.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. crm_tasks — THE LEAK. `tasks_unit_all` (authenticated, business-unit
--    scoped) already covers every read/write the CRM browser performs
--    (CRMApp.tsx:1668/1680/1701/1741), so dropping the public-role policy
--    removes anon access and changes nothing for signed-in agents.
-- ---------------------------------------------------------------------------
drop policy if exists "service role full access" on public.crm_tasks;

-- ---------------------------------------------------------------------------
-- 2. Same anti-pattern, no browser access at all (both tables are written only
--    by service-role routes, and both are currently empty). After the drop they
--    have zero policies + RLS on = deny-all to anon and authenticated, which is
--    exactly right; service-role keeps full access by bypassing RLS.
-- ---------------------------------------------------------------------------
drop policy if exists "service role full access" on public.email_tracking_events;
drop policy if exists "service role full access" on public.lead_routing_rules;

-- ---------------------------------------------------------------------------
-- 3. crm_campaign_projects — was `for all to public using (true) with (true)`.
--    The browser does select/insert/update/delete here
--    (CRMApp.tsx:2474/2484/2494/2501) and the table has no business_unit
--    column, so it stays shared across the workspace — but for signed-in users
--    only. Restricting the grantee to `authenticated` is the whole fix.
-- ---------------------------------------------------------------------------
drop policy if exists "crm_campaign_projects_all" on public.crm_campaign_projects;
drop policy if exists "crm_campaign_projects authenticated" on public.crm_campaign_projects;
create policy "crm_campaign_projects authenticated" on public.crm_campaign_projects
  for all to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- 4. crm_notifications — the INSERT policy was named *authenticated*_insert but
--    was granted to `public` with check (true), so anon could inject
--    notifications into any agent's feed. Same rule, correct grantee.
--    SELECT/UPDATE already filter on recipient_id = auth.uid() (null for anon,
--    so they were never readable); their grantee is tightened for clarity.
-- ---------------------------------------------------------------------------
drop policy if exists "authenticated_insert_notifications" on public.crm_notifications;
create policy "authenticated_insert_notifications" on public.crm_notifications
  for insert to authenticated
  with check (true);

drop policy if exists "agents_see_own_notifications" on public.crm_notifications;
create policy "agents_see_own_notifications" on public.crm_notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

drop policy if exists "recipient_update_notifications" on public.crm_notifications;
create policy "recipient_update_notifications" on public.crm_notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. leads — "Anyone can insert leads" allowed anon INSERT with check (true),
--    i.e. unauthenticated writes straight into the leads table. Nothing in the
--    browser bundle inserts here: the public forms all POST to /api/leads,
--    /api/quiz/lead and /api/webhook/lead, which are rate-limited, validated
--    and use the service-role key. "Auth insert leads" stays for signed-in use.
-- ---------------------------------------------------------------------------
drop policy if exists "Anyone can insert leads" on public.leads;

commit;

-- ============================================================================
-- VERIFY (read-only)
--
-- 1) No policy should grant the public role an unconditional true any more,
--    except the intentional marketing-site reads
--    (agents / listings / neighborhoods / site_settings / testimonials):
--
--    select tablename, policyname, cmd, roles::text
--    from pg_policies
--    where schemaname='public' and roles::text like '%public%'
--      and (qual = 'true' or with_check = 'true')
--    order by tablename;
--
-- 2) As anon (publishable key), these must return 0 rows:
--    curl "$SUPABASE_URL/rest/v1/crm_tasks?select=*&limit=1"             -H "apikey: $ANON"
--    curl "$SUPABASE_URL/rest/v1/crm_campaign_projects?select=*&limit=1" -H "apikey: $ANON"
--
-- 3) As a signed-in agent, crm_tasks must still return their unit's rows:
--    set local role authenticated;
--    select set_config('request.jwt.claims',
--      json_build_object('sub','<crm_profiles.id>','role','authenticated')::text, true);
--    select count(*) from crm_tasks;
--
-- ROLLBACK (only if the CRM UI breaks — re-scope, never re-open to public):
--    create policy "crm_campaign_projects authenticated" on public.crm_campaign_projects
--      for all to authenticated using (true) with check (true);
-- ============================================================================
