-- audit_logs: lock the TABLE, not just the route.
--
-- THE HOLE. The only policy was:
--     using (exists (select 1 from crm_profiles
--                    where id = auth.uid() and role = 'admin'))
-- `role = 'admin'` is a literal string, so it granted the broker-level admin and
-- excluded the owner. Combined with a blanket SELECT grant to `authenticated`,
-- any admin could read the whole table straight from the browser with the public
-- anon key. Measured before this migration: Brian read 150 rows of Zack's own
-- activity — 141 anti-scrape `bulk_read_detected` alerts plus his exports,
-- password reset and Copilot trail.
--
-- The /api/crm/copilot-activity route already implements the correct rule
-- (allowedActorIds + hiddenActorIds). That route was never the problem; it was
-- simply the front door on an unlocked table. This pushes the SAME rule down to
-- the row level so it also holds for a direct PostgREST query.
--
-- THE RULE, identical to the route's:
--   * the owner (super_admin) sees every row;
--   * everyone else sees only rows they are the actor of;
--   * and never a row whose actor is an owner — the floor that survives a role
--     change or a second owner ever existing.
--
-- Brian therefore KEEPS his own trail (his export_requested / export_blocked
-- rows), exactly as the route intends: "an admin gets their own trail like
-- anyone else." He loses only the owner's.
--
-- auth.uid() is NULL for anon, and `actor_id = NULL` is NULL, not true — so an
-- unauthenticated reader matches no row. Fail-closed by construction.
--
-- Nothing here touches the app's read path: all three code sites that touch
-- audit_logs (lib/audit.ts, lib/crm-read-guard.ts, the copilot-activity route)
-- use the service-role key, which bypasses RLS. Verified before applying.

-- ── 1. The owner set, as a SECURITY DEFINER lookup ──────────────────────────
-- Mirrors hiddenActorIds() in the route. SECURITY DEFINER so the policy does not
-- re-enter crm_profiles' own RLS; search_path pinned so the body cannot be
-- hijacked by a caller-supplied path.
create or replace function public.crm_owner_ids()
returns uuid[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.crm_profiles
  where role = 'super_admin';
$$;

revoke all on function public.crm_owner_ids() from public, anon;
grant execute on function public.crm_owner_ids() to authenticated, service_role;

-- ── 2. Replace the policy ───────────────────────────────────────────────────
drop policy if exists admins_read_audit_logs on public.audit_logs;
drop policy if exists audit_logs_owner_and_self_read on public.audit_logs;

create policy audit_logs_owner_and_self_read
on public.audit_logs
for select
to authenticated
using (
  public.crm_is_super_admin()
  or (
    actor_id = (select auth.uid())
    and not (actor_id = any (public.crm_owner_ids()))
  )
);

-- No INSERT/UPDATE/DELETE policy exists by design. The table is an immutable
-- append-only trail written by the service role; with RLS on and no write
-- policy, anon and authenticated are denied every write regardless of grants.

-- ── 3. Least privilege on the grants (finding #3) ───────────────────────────
-- anon had DELETE/INSERT/UPDATE/TRUNCATE/SELECT on the audit trail. Nothing
-- reads or writes this table with the anon key; revoke the lot.
revoke all on table public.audit_logs from anon;

-- authenticated keeps SELECT only, and that SELECT is gated by the policy above.
revoke insert, update, delete, truncate, references, trigger
  on table public.audit_logs from authenticated;
grant select on table public.audit_logs to authenticated;

-- The service role writes the trail and backs the owner-facing route.
grant all on table public.audit_logs to service_role;
