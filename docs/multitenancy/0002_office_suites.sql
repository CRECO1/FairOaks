-- 0002_office_suites.sql
-- Backs the CRM "Properties" tab — an editable, per-suite overlay for the fixed
-- building floor plans (8000 Fair Oaks Pkwy, Bldg 1).
--
-- The floor-plan GEOMETRY (walls, doors, room shapes) lives in the React
-- component (PropertiesFloorPlan.tsx). This table stores ONLY the editable
-- per-suite fields: tenant, suite number, status, color, square footage, notes.
-- A missing row simply means "use the component default" — so the table can
-- start empty and the plan still renders correctly. Editing a suite upserts a
-- row keyed by (business_unit, building, floor, suite_key).
--
-- Safe to run once on the hosted Supabase project. Wrapped in a transaction.
-- Does NOT touch any existing table.

begin;

create table if not exists public.office_suites (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.organizations(id),
  business_unit text not null default 'commercial',
  building      text not null default 'bldg1',
  floor         integer not null,
  suite_key     text not null,
  suite_number  text,
  tenant_name   text,
  status        text not null default 'occupied'
                  check (status in ('occupied','vacant','reserved')),
  color         text,
  sq_ft         integer,
  notes         text,
  updated_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_unit, building, floor, suite_key)
);

comment on table public.office_suites is
  'Editable per-suite overlay for the CRM Properties floor plans. Geometry lives in the app; rows are overrides keyed by (business_unit, building, floor, suite_key).';

alter table public.office_suites enable row level security;

-- Defense-in-depth org isolation. The CRM API uses the service-role key, which
-- BYPASSES RLS; app-layer business_unit scoping is the primary enforcement.
-- Only created if the multitenancy helper auth_org_id() exists in this project.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'auth_org_id') then
    execute $p$
      create policy org_isolation on public.office_suites
        as restrictive for all to authenticated
        using (org_id is null or org_id = public.auth_org_id())
        with check (org_id is null or org_id = public.auth_org_id())
    $p$;
  end if;
end$$;

-- Permissive read/write for authenticated users (AND-ed with the restrictive
-- org policy above when present).
create policy office_suites_rw on public.office_suites
  for all to authenticated
  using (true)
  with check (true);

-- keep updated_at fresh on every update
create or replace function public.touch_office_suites_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists trg_office_suites_updated_at on public.office_suites;
create trigger trg_office_suites_updated_at
  before update on public.office_suites
  for each row execute function public.touch_office_suites_updated_at();

commit;
