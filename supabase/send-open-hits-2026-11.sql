-- Per-load log of the open-tracking pixel for CAMPAIGN and ACTION-PLAN emails, 2026-11-04 (same idea as crm_email_open_hits for
-- one-to-one emails): the pixel is no-store, so Gmail's proxy re-fetches it on every display and open_count ran far ahead of real opens.
-- Server-only (service role); no browser access.
begin;

create table if not exists public.crm_send_open_hits (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('campaign', 'action_plan')),
  send_id     uuid not null,                 -- crm_campaign_sends.id or crm_action_plan_sends.id (by kind)
  at          timestamptz not null default now(),
  user_agent  text,
  ip_hash     text,
  agent_kind  text,                          -- 'gmail-proxy' | 'yahoo-proxy' | 'security-scanner' | 'other'
  counted     boolean not null default false -- true = started a new "open" (first, or 30+ minutes after the previous load)
);
create index if not exists crm_send_open_hits_send_idx on public.crm_send_open_hits (kind, send_id, at desc);

alter table public.crm_send_open_hits enable row level security;
revoke all on public.crm_send_open_hits from anon, authenticated;

commit;

-- Rollback: drop table public.crm_send_open_hits;
