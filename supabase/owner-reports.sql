-- Personalized owner property reports (crecotx.com/r/<token>).
-- One row per owner: a snapshot of their parcels from the county appraisal
-- roll plus county-wide benchmarks, reachable only by an unguessable token.
-- crecotx.com reads it server-side with the CRM service role and records
-- views / opinion-of-value requests back here. Service-role only.
create table if not exists public.crm_owner_reports (
  id uuid primary key default gen_random_uuid(),
  token text not null unique check (length(token) >= 16),
  client_id uuid references public.crm_clients(id) on delete cascade,
  owner_entity text not null,
  contact_name text,
  county text not null,
  roll_year int not null,
  properties jsonb not null,
  benchmark jsonb not null,
  created_at timestamptz not null default now(),
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  view_count int not null default 0,
  interest text,
  bov_requested_at timestamptz,
  bov_phone text
);
create index if not exists crm_owner_reports_client_idx on public.crm_owner_reports(client_id);
alter table public.crm_owner_reports enable row level security;
revoke all on public.crm_owner_reports from anon, authenticated;
