-- ============================================================================
-- Agent-level ownership in RLS   (anti-scrape: closes the direct-PostgREST path)
-- Project: bnqdzgypesoythpbeujk  ·  Run in the Supabase SQL editor.
--
-- WHY THIS EXISTS
--
-- The CRM browser client talks to several crm_* tables DIRECTLY with the
-- publishable key and each user's own session — CRMApp.tsx does
-- `supabase.from('crm_deals').select('*')` in the browser. For those reads, the
-- only thing standing between a user and a row is RLS.
--
-- rls-workspace-isolation.sql scoped those tables to the caller's business_unit.
-- It did not scope them to the caller. No policy in this database contains an
-- agent_id clause. The per-agent filter that the UI applies —
--
--     if (p.role === 'agent') q = q.or(`agent_id.eq.${p.id},...`)   (CRMApp.tsx)
--
-- runs in the browser, on data the database already agreed to send. So today an
-- agent can open devtools, take their own session token, and read EVERY deal,
-- task and commission in their business unit straight from
-- https://<project>.supabase.co/rest/v1/... — no Next.js route, no rate limit,
-- no pagination cap, no audit row, and no export request. That is precisely the
-- bulk-extraction path the export-approval workflow exists to prevent, and
-- rate-limiting the API routes does nothing about it.
--
-- WHAT THIS CHANGES
--
--   crm_deals, crm_tasks, crm_commissions
--     agents: rows they own or are assigned to. admins/super_admins: the unit.
--     This matches what the UI already shows an agent, so it should be invisible
--     in normal use — it just makes the database enforce it too.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
--
--   crm_clients stays business-unit-wide. The contact book is SHARED on purpose:
--   loadClients() pulls every contact in the unit for every role, agents
--   included, and the Contacts page is built around that. Narrowing it here
--   would break the product, not harden it. The controls for the book are the
--   export-approval workflow, the read budgets in lib/crm-read-guard.ts, and the
--   audit trail — not row hiding. Revisit only if you decide agents should stop
--   seeing the shared book, and change the UI in the same breath.
--
-- ⚠️ APPLY DELIBERATELY.
--   1. Run the VERIFY block at the bottom first.
--   2. Apply, then click through the CRM as a NON-admin agent: Deals kanban,
--      Tasks, Commissions, and a deal opened from the Dashboard.
--   3. If something an agent legitimately needs disappears, fix it by widening
--      the ownership test (e.g. add a column to the OR), never by dropping the
--      policy. Rollback is at the bottom.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- Helper: is the current user an owner/assignee of this row?
-- security definer so it can read crm_profiles without recursing through RLS.
-- ---------------------------------------------------------------------------
create or replace function public.crm_is_agent()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role = 'agent' from public.crm_profiles where id = auth.uid()),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- crm_deals — owner, or named in assigned_agent_ids.
-- ---------------------------------------------------------------------------
drop policy if exists "crm_deals unit read" on public.crm_deals;
drop policy if exists "crm_deals owner read" on public.crm_deals;
create policy "crm_deals owner read" on public.crm_deals
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

-- ---------------------------------------------------------------------------
-- crm_tasks — assigned to, or raised by, the caller.
-- ---------------------------------------------------------------------------
drop policy if exists "crm_tasks unit read" on public.crm_tasks;
drop policy if exists "crm_tasks owner read" on public.crm_tasks;
create policy "crm_tasks owner read" on public.crm_tasks
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

-- ---------------------------------------------------------------------------
-- crm_commissions — an agent sees their own split and nobody else's.
-- What each agent earns is the most sensitive per-row data in the CRM.
-- ---------------------------------------------------------------------------
drop policy if exists "crm_commissions unit read" on public.crm_commissions;
drop policy if exists "crm_commissions owner read" on public.crm_commissions;
create policy "crm_commissions owner read" on public.crm_commissions
  for select to authenticated
  using (
    public.crm_is_admin()
    or (
      business_unit = public.crm_current_bu()
      and (not public.crm_is_agent() or agent_id = auth.uid())
    )
  );

commit;

-- ============================================================================
-- VERIFY — run BEFORE applying, to confirm the columns referenced above exist.
-- ============================================================================
-- select table_name, column_name
--   from information_schema.columns
--  where table_schema = 'public'
--    and table_name in ('crm_deals','crm_tasks','crm_commissions')
--    and column_name in ('agent_id','assigned_agent_ids','assigned_to','created_by','business_unit')
--  order by table_name, column_name;
--
-- Confirm assigned_agent_ids is uuid[] (not text[]). If it is text[], change
-- `auth.uid() = any (coalesce(assigned_agent_ids,'{}'::uuid[]))` to
-- `auth.uid()::text = any (coalesce(assigned_agent_ids,'{}'::text[]))`.
--
-- AFTER applying, confirm the hole is actually closed. As a NON-admin agent's
-- session token (not the service key):
--   curl -s "https://<project>.supabase.co/rest/v1/crm_deals?select=id" \
--        -H "apikey: <publishable key>" -H "Authorization: Bearer <agent JWT>" | jq length
-- Before: every deal in the unit. After: only that agent's.
--
-- ============================================================================
-- ROLLBACK — restores the previous unit-wide read policies.
-- ============================================================================
-- begin;
-- drop policy if exists "crm_deals owner read"       on public.crm_deals;
-- drop policy if exists "crm_tasks owner read"       on public.crm_tasks;
-- drop policy if exists "crm_commissions owner read" on public.crm_commissions;
-- create policy "crm_deals unit read"       on public.crm_deals       for select to authenticated using (public.crm_is_admin() or business_unit = public.crm_current_bu());
-- create policy "crm_tasks unit read"       on public.crm_tasks       for select to authenticated using (public.crm_is_admin() or business_unit = public.crm_current_bu());
-- create policy "crm_commissions unit read" on public.crm_commissions for select to authenticated using (public.crm_is_admin() or business_unit = public.crm_current_bu());
-- commit;
