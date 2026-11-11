-- Matchmaker: richer tenant needs + a log of what was matched and emailed.
--
-- Builds on supabase/matchmaker.sql (asset_types + req_size/req_price/req_submarkets on crm_clients). Everything here is ADDITIVE and
-- idempotent: new nullable columns / columns with a default, one new table. Nothing existing changes shape, and nothing is emailed
-- until an agent turns "Email me new matches" on for a tenant — req_auto_match defaults to false.
--
--   crm_clients.req_deal_type       'lease' | 'sale' (null = either) — the Lease / Buy toggle, now saved with the tenant
--   crm_clients.req_rate_max        lease budget, $/SF/yr
--   crm_clients.req_move_in_by      target occupancy date
--   crm_clients.req_must_haves      free text: "drive-thru, 24' clear, corner"
--   crm_clients.req_active          the tenant is actively searching
--   crm_clients.req_auto_match      email the owning agent new matches (daily job)
--   crm_clients.req_last_matched_at when the daily job last looked
--   crm_need_matches                one row per (tenant, property) the Matchmaker has surfaced: score, why, and whether it was emailed
--                                   or dismissed ("not a fit"). Server-only: the app reads and writes it through /api/crm/matchmaker/*
--                                   with the service role, so no browser role is granted anything.
--
-- Run in the Supabase SQL editor (project bnqdzgypesoythpbeujk) or with node pg via the pooler. Safe to re-run.

alter table public.crm_clients
  add column if not exists req_deal_type       text,
  add column if not exists req_rate_max        numeric,
  add column if not exists req_move_in_by      date,
  add column if not exists req_must_haves      text,
  add column if not exists req_active          boolean not null default false,
  add column if not exists req_auto_match      boolean not null default false,
  add column if not exists req_last_matched_at timestamptz;

-- NOT VALID first (no table scan, no long lock on a busy table), then validate.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'crm_clients_req_deal_type_check') then
    alter table public.crm_clients
      add constraint crm_clients_req_deal_type_check check (req_deal_type is null or req_deal_type in ('lease', 'sale')) not valid;
    alter table public.crm_clients validate constraint crm_clients_req_deal_type_check;
  end if;
end $$;

-- The daily job only ever looks at tenants who are searching AND opted in.
create index if not exists crm_clients_req_auto_idx on public.crm_clients (agent_id) where req_active and req_auto_match;

create table if not exists public.crm_need_matches (
  client_id     uuid not null references public.crm_clients(id) on delete cascade,
  property_id   uuid not null references public.crm_prospective_properties(id) on delete cascade,
  score         integer,
  fit           text,                                   -- strong | good | possible
  reasons       text[] not null default '{}',
  caveats       text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  emailed_at    timestamptz,
  emailed_to    text,                                   -- 'agent' | 'client'
  dismissed_at  timestamptz,
  dismissed_by  uuid references public.crm_profiles(id) on delete set null,
  primary key (client_id, property_id)
);

create index if not exists crm_need_matches_property_idx on public.crm_need_matches (property_id);

alter table public.crm_need_matches enable row level security;
revoke all on public.crm_need_matches from anon, authenticated;
