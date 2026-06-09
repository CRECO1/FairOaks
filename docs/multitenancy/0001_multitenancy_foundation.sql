-- ============================================================================
-- VultStack — Multi-tenancy foundation (DB layer)
-- Migration 0001: organizations + org_id + org-isolation RLS
-- ============================================================================
-- STATUS: DRAFT — for review. DO NOT run against production until the app-layer
--         changes (see PLAN.md, Phase 3) are merged and the backfill org is
--         confirmed. Designed to be safe on the CURRENT single-tenant database
--         (one account = Fair Oaks Realty Group, two business_units).
--
-- WHAT THIS DOES
--   1. Creates `organizations` (the tenant) + membership via crm_profiles.org_id
--   2. Adds `org_id` to every PRIVATE CRM/social table, backfills to the one
--      existing org, then enforces NOT NULL + FK + index
--   3. Adds an `auth_org_id()` helper and a RESTRICTIVE org-isolation policy on
--      every tenant table. Restrictive policies are AND-ed with the existing
--      permissive policies, so we get org isolation WITHOUT rewriting the ~60
--      existing agent/admin policies.
--
-- WHAT THIS DOES NOT DO
--   * Does NOT touch the public website tables (agents, listings, neighborhoods,
--     testimonials, leads, listing_alerts, site_settings, admin_users). Per-org
--     public sites are a separate product decision — see PLAN.md, Phase 5.
--   * Does NOT enforce isolation for service-role queries. The CRM API uses the
--     Supabase SERVICE ROLE key, which BYPASSES RLS. App-layer scoping
--     (PLAN.md, Phase 3) is the PRIMARY enforcement; this RLS is defense-in-depth
--     for any direct anon/authenticated JWT access.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. organizations (the tenant)
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,                 -- subdomain / path key
  status      text not null default 'active'
              check (status in ('active','trial','suspended','canceled')),
  -- Stripe billing fields are added in a later migration (Phase 4); kept out
  -- here to keep the foundation focused.
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.organizations enable row level security;

-- Seed the single existing tenant. Slug 'fair-oaks' is the umbrella account
-- that contains BOTH business_units (residential = Fair Oaks, commercial = CRECO).
insert into public.organizations (name, slug)
values ('Fair Oaks Realty Group', 'fair-oaks')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Membership: one org per user (sufficient for per-seat billing).
--    A person who works at two brokerages gets two logins.
-- ---------------------------------------------------------------------------
alter table public.crm_profiles
  add column if not exists org_id uuid references public.organizations(id);

update public.crm_profiles
  set org_id = (select id from public.organizations where slug = 'fair-oaks')
  where org_id is null;

alter table public.crm_profiles alter column org_id set not null;
create index if not exists idx_crm_profiles_org on public.crm_profiles(org_id);

-- ---------------------------------------------------------------------------
-- 3. org_id resolver. SECURITY DEFINER so it reads crm_profiles bypassing RLS
--    (prevents infinite recursion when used inside crm_profiles' own policy).
-- ---------------------------------------------------------------------------
create or replace function public.auth_org_id()
  returns uuid
  language sql
  stable
  security definer
  set search_path = 'public'
as $$
  select org_id from public.crm_profiles where id = auth.uid();
$$;

-- Make crm_is_admin() org-aware is NOT needed: the restrictive org policy below
-- already bounds admins to their own org. (crm_is_admin still only checks role.)

-- ---------------------------------------------------------------------------
-- 4. Add org_id to every private tenant table, backfill, constrain, index,
--    and attach a RESTRICTIVE org-isolation policy.
--
--    NOTE on backfill & locks: all current tables belong to ONE org, so the
--    single-value backfill is correct today. Tables are small (one brokerage,
--    months of data) so `SET NOT NULL` table scans are cheap. For a large
--    table in the future, do: add column nullable -> batched backfill ->
--    `ADD CONSTRAINT ... CHECK (org_id IS NOT NULL) NOT VALID` -> `VALIDATE`.
--
--    NOTE on child tables (crm_deal_emails, crm_deal_docs, crm_campaign_sends,
--    crm_campaign_enrollments, crm_action_plan_sends/steps/enrollments): org_id
--    is DENORMALIZED (copied from parent) so RLS stays index-only with no joins.
--    Going forward, inserts must set org_id from the parent/caller context.
-- ---------------------------------------------------------------------------
do $$
declare
  t   text;
  org uuid := (select id from public.organizations where slug = 'fair-oaks');
  tenant_tables text[] := array[
    'crm_clients','crm_deals','crm_deal_docs','crm_deal_emails','crm_commissions',
    'crm_tasks','crm_outside_agents','crm_client_activities','crm_action_plans',
    'crm_action_plan_enrollments','crm_action_plan_sends','crm_action_plan_steps',
    'crm_campaigns','crm_campaign_enrollments','crm_campaign_sends','crm_smart_lists',
    'email_lead_imports','email_tracking_events','lead_routing_rules','gmail_connections',
    'social_analytics','social_connections','social_inbox','social_posts',
    'social_saved_replies','audit_logs'
  ];
begin
  foreach t in array tenant_tables loop
    execute format(
      'alter table public.%I add column if not exists org_id uuid references public.organizations(id)', t);
    execute format(
      'update public.%I set org_id = %L where org_id is null', t, org);
    execute format(
      'alter table public.%I alter column org_id set not null', t);
    execute format(
      'create index if not exists %I on public.%I (org_id)', 'idx_' || t || '_org', t);

    -- Restrictive policy: AND-ed with existing permissive policies. A row is only
    -- visible/writable if it ALSO belongs to the caller's org. Fail-closed:
    -- auth_org_id() is NULL for users with no profile -> no rows match.
    execute format('drop policy if exists org_isolation on public.%I', t);
    execute format(
      'create policy org_isolation on public.%I as restrictive for all to authenticated '
      || 'using (org_id = public.auth_org_id()) with check (org_id = public.auth_org_id())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Org isolation on crm_profiles itself.
--    Today "Authenticated users can read all profiles" leaks every user across
--    orgs. The restrictive policy bounds all access to the caller's org.
--    auth_org_id() is SECURITY DEFINER so this does not recurse.
-- ---------------------------------------------------------------------------
drop policy if exists org_isolation on public.crm_profiles;
create policy org_isolation on public.crm_profiles
  as restrictive for all to authenticated
  using (org_id = public.auth_org_id())
  with check (org_id = public.auth_org_id());

-- ---------------------------------------------------------------------------
-- 6. organizations RLS: a member can read their own org row only.
--    Writes (create/rename/suspend) go through service-role / super-admin.
-- ---------------------------------------------------------------------------
drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own on public.organizations
  for select to authenticated
  using (id = public.auth_org_id());

commit;

-- ============================================================================
-- ROLLBACK (manual, if needed before app layer ships)
--   The change is additive (new table + nullable-then-not-null columns + new
--   policies). To fully revert:
--     - drop policy org_isolation on each tenant table + crm_profiles
--     - drop policy organizations_select_own on organizations
--     - alter table ... drop column org_id  (each tenant table + crm_profiles)
--     - drop function auth_org_id()
--     - drop table organizations
-- ============================================================================
