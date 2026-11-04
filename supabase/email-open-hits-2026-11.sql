-- Per-load log of the open-tracking pixel for CRM-sent (deal/contact) emails, 2026-11-04.
-- Why: crm_deal_emails.open_count only counts loads (a mail program re-fetching the pixel looked like "opened 208×") and keeps no detail.
-- Each load is now recorded with its time, device string and a short hash of the address, so people can be told apart from proxies and
-- scanners. Server-only (written/read with the service role); no browser access.
begin;

create table if not exists public.crm_email_open_hits (
  id          bigint generated always as identity primary key,
  email_id    uuid not null references public.crm_deal_emails(id) on delete cascade,
  at          timestamptz not null default now(),
  user_agent  text,
  ip_hash     text,
  agent_kind  text,            -- 'gmail-proxy' | 'yahoo-proxy' | 'security-scanner' | 'other'
  counted     boolean not null default false   -- true = this load started a new "open" (first, or 30+ minutes after the previous load)
);
create index if not exists crm_email_open_hits_email_idx on public.crm_email_open_hits (email_id, at desc);

alter table public.crm_email_open_hits enable row level security;
revoke all on public.crm_email_open_hits from anon, authenticated;

commit;

-- Rollback: drop table public.crm_email_open_hits;
