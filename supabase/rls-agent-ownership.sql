-- ============================================================================
-- Agent-level ownership in RLS   (anti-scrape: closes the direct-PostgREST path)
-- Project: bnqdzgypesoythpbeujk
--
-- WHY THIS EXISTS
--
-- The CRM browser client talks to crm_* tables DIRECTLY with the publishable key
-- and each user's own session — CRMApp.tsx does `supabase.from('crm_deals')
-- .select('*')` in the browser. For those reads, RLS is the only control.
--
-- The per-agent filter users see in the UI runs in the browser:
--     if (p.role === 'agent') q = q.or(`agent_id.eq.${p.id},...`)
-- on rows the database already agreed to send. So an agent could take their own
-- session token from devtools and read every deal and task in their business unit
-- straight from https://<project>.supabase.co/rest/v1/… — no API route, no rate
-- limit, no audit row, no export request. That is the bulk-extraction path the
-- export-approval workflow exists to prevent, and rate-limiting the Next.js routes
-- does not touch it.
--
-- WHAT WAS ACTUALLY THERE  (checked against the live database, not assumed)
--
-- crm_deals and crm_tasks each carried a PERMISSIVE policy for ALL commands —
-- `deals_unit_all` / `tasks_unit_all` — with
--     using (crm_is_admin() OR business_unit = crm_current_bu())
-- i.e. unit-wide. crm_deals ALSO had per-command policies ("Agents see own deals"
-- etc.) that were already agent-scoped — but PERMISSIVE policies are OR'ed, so the
-- unit-wide ALL policy simply won and the scoped ones never narrowed anything.
--
-- This is why the earlier draft of this file did nothing: it added scoped SELECT
-- policies ALONGSIDE the unit-wide ALL policies, which OR together to exactly the
-- unit-wide access we were trying to remove. The over-broad policy has to be
-- dropped, not out-voted.
--
-- The pre-existing scoped policies also tested `p.role = 'admin'` as a literal,
-- which EXCLUDES super_admin — so relying on them alone would have hidden the
-- owner's own records from him. They are replaced with crm_is_admin(), which
-- covers admin and super_admin both.
--
-- WHAT THIS CHANGES
--
--   crm_deals  — SELECT/UPDATE: admins see the unit; everyone else sees only rows
--                they own (agent_id) or are assigned to (assigned_agent_ids).
--                INSERT stays unit-scoped, DELETE becomes admin-only via
--                crm_is_admin() (was role='admin', which locked out super_admin).
--   crm_tasks  — SELECT/UPDATE: admins see the unit; everyone else sees tasks
--                assigned to them, raised by them, or owned by them.
--                INSERT stays unit-scoped (agents legitimately create tasks via
--                Matchmaker and the Call Queue).
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
--
--   crm_commissions is ALREADY sealed: `crm_commissions_service_only` is a
--   RESTRICTIVE ALL policy with `using (false)` for anon and authenticated.
--   Restrictive policies AND with the permissive ones, so false wins and no
--   browser session reaches that table at all — only the service role does.
--   Adding scoped policies there would be theatre. Left untouched.
--
--   crm_clients stays business-unit-wide. The contact book is SHARED on purpose:
--   loadClients() pulls every contact in the unit for every role and the Contacts
--   page is built around it. Narrowing it here would break the product, not harden
--   it. That book is governed by the export-approval workflow, the read budgets in
--   lib/crm-read-guard.ts, and the audit trail.
--
-- SAFETY NOTE: every Next.js API route and the Copilot use the SERVICE ROLE key,
-- which bypasses RLS entirely. Nothing here can affect them. This changes only what
-- the browser's own session can fetch directly.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- Is the caller a non-admin? Admins (and super_admins) see their whole unit;
-- everyone else is confined to their own rows. security definer so it can read
-- crm_profiles without recursing through that table's own RLS.
create or replace function public.crm_is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select not coalesce(
    (select role in ('admin','super_admin') from public.crm_profiles where id = auth.uid()),
    false
  );
$$;

-- ── crm_deals ───────────────────────────────────────────────────────────────
-- Drop the unit-wide ALL policy and the role='admin' variants together, so what
-- remains is one coherent set rather than a mix that ORs back to unit-wide.
drop policy if exists "deals_unit_all"          on public.crm_deals;
drop policy if exists "Agents see own deals"    on public.crm_deals;
drop policy if exists "Agents update own deals" on public.crm_deals;
drop policy if exists "Agents insert own deals" on public.crm_deals;
drop policy if exists "Admins delete deals"     on public.crm_deals;
drop policy if exists "deals_scoped_select"     on public.crm_deals;
drop policy if exists "deals_scoped_insert"     on public.crm_deals;
drop policy if exists "deals_scoped_update"     on public.crm_deals;
drop policy if exists "deals_admin_delete"      on public.crm_deals;

create policy "deals_scoped_select" on public.crm_deals
  for select to authenticated
  using (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (
        not public.crm_is_agent()
        or agent_id = auth.uid()
        or auth.uid() = any (coalesce(assigned_agent_ids, '{}'::uuid[]))
      )
    )
  );

create policy "deals_scoped_insert" on public.crm_deals
  for insert to authenticated
  with check (
    public.crm_is_admin()
    or (business_unit = public.crm_current_bu() and (not public.crm_is_agent() or agent_id = auth.uid()))
  );

create policy "deals_scoped_update" on public.crm_deals
  for update to authenticated
  using (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (not public.crm_is_agent() or agent_id = auth.uid() or auth.uid() = any (coalesce(assigned_agent_ids, '{}'::uuid[])))
    )
  )
  with check (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (not public.crm_is_agent() or agent_id = auth.uid() or auth.uid() = any (coalesce(assigned_agent_ids, '{}'::uuid[])))
    )
  );

-- Was role='admin', which silently excluded the owner (super_admin).
create policy "deals_admin_delete" on public.crm_deals
  for delete to authenticated
  using (public.crm_is_admin());

-- ── crm_tasks ───────────────────────────────────────────────────────────────
drop policy if exists "tasks_unit_all"      on public.crm_tasks;
drop policy if exists "tasks_scoped_select" on public.crm_tasks;
drop policy if exists "tasks_unit_insert"   on public.crm_tasks;
drop policy if exists "tasks_scoped_update" on public.crm_tasks;
drop policy if exists "tasks_admin_delete"  on public.crm_tasks;

create policy "tasks_scoped_select" on public.crm_tasks
  for select to authenticated
  using (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (
        not public.crm_is_agent()
        or assigned_to = auth.uid()
        or agent_id = auth.uid()
        or created_by = auth.uid()
      )
    )
  );

-- Insert stays unit-scoped: Matchmaker and the Call Queue legitimately create
-- tasks for other people, and narrowing this would break both.
create policy "tasks_unit_insert" on public.crm_tasks
  for insert to authenticated
  with check (public.crm_is_admin() or business_unit = public.crm_current_bu());

create policy "tasks_scoped_update" on public.crm_tasks
  for update to authenticated
  using (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (not public.crm_is_agent() or assigned_to = auth.uid() or agent_id = auth.uid() or created_by = auth.uid())
    )
  )
  with check (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (not public.crm_is_agent() or assigned_to = auth.uid() or agent_id = auth.uid() or created_by = auth.uid())
    )
  );

create policy "tasks_admin_delete" on public.crm_tasks
  for delete to authenticated
  using (public.crm_is_admin());

commit;

-- ============================================================================
-- ROLLBACK — restores the previous unit-wide policies exactly as they were.
-- ============================================================================
-- begin;
-- drop policy if exists "deals_scoped_select" on public.crm_deals;
-- drop policy if exists "deals_scoped_insert" on public.crm_deals;
-- drop policy if exists "deals_scoped_update" on public.crm_deals;
-- drop policy if exists "deals_admin_delete"  on public.crm_deals;
-- drop policy if exists "tasks_scoped_select" on public.crm_tasks;
-- drop policy if exists "tasks_unit_insert"   on public.crm_tasks;
-- drop policy if exists "tasks_scoped_update" on public.crm_tasks;
-- drop policy if exists "tasks_admin_delete"  on public.crm_tasks;
-- create policy "deals_unit_all" on public.crm_deals for all to authenticated
--   using (crm_is_admin() or business_unit = crm_current_bu())
--   with check (crm_is_admin() or business_unit = crm_current_bu());
-- create policy "tasks_unit_all" on public.crm_tasks for all to authenticated
--   using (crm_is_admin() or business_unit = crm_current_bu())
--   with check (crm_is_admin() or business_unit = crm_current_bu());
-- commit;
