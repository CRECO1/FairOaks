-- CRM phone alerts (web push). One row per phone/browser an agent turned alerts on for.
-- RLS is on with NO policies: only the service role (server routes) touches it, and an agent's
-- browser never sees anyone else's push endpoint/keys.
create table if not exists public.crm_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.crm_profiles(id) on delete cascade,
  -- Unique per device: re-subscribing (or a shared phone changing hands) is an upsert, never a double buzz.
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  -- What this device wants to hear about: mentions (tags + assignments), leads, calls, signatures, visitors.
  categories   text[] not null default '{mentions,leads,calls,signatures}',
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz
);
create index if not exists crm_push_subscriptions_profile_idx on public.crm_push_subscriptions (profile_id);
alter table public.crm_push_subscriptions enable row level security;
