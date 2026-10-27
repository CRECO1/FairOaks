-- Property DB shortlists: each agent's own starred properties.
--
-- One row per (agent, property). Personal — an agent only ever sees and changes their own stars, and
-- stars are not visible to other agents or admins. Server-only table: the app reads and writes it through
-- /api/crm/property-shortlist with the service role, so no browser role is granted anything (RLS on, no
-- policies, privileges revoked) — a direct PostgREST call from the browser gets nothing.
--
-- Cascades: removing an agent or a property removes their stars with it, so nothing dangles.
-- Idempotent; safe to re-run.

create table if not exists public.crm_property_shortlist (
  user_id     uuid not null references public.crm_profiles(id) on delete cascade,
  property_id uuid not null references public.crm_prospective_properties(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, property_id)
);

create index if not exists crm_property_shortlist_property_idx on public.crm_property_shortlist (property_id);

alter table public.crm_property_shortlist enable row level security;
revoke all on public.crm_property_shortlist from anon, authenticated;
