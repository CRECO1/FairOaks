-- Scheduled emails ("send later"): an email an agent wrote now and wants sent at a chosen time.
--
-- `payload` is exactly what Compose would have POSTed to /api/gmail/send, so a cron sends it through the very
-- same path as a normal send (signature, open tracking, filing on the deal/contact, Gmail threading).
-- Personal: an agent only ever sees and changes their own. Server-only table (RLS on, no policies, privileges
-- revoked); /api/crm/scheduled-emails and /api/cron/scheduled-emails use the service role.
-- Idempotent; safe to re-run.

create table if not exists public.crm_scheduled_emails (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.crm_profiles(id) on delete cascade,
  send_at         timestamptz not null,
  payload         jsonb not null,
  summary_to      text not null default '',
  summary_subject text not null default '',
  status          text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'cancelled')),
  attempts        int  not null default 0,
  last_error      text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists crm_scheduled_emails_due_idx  on public.crm_scheduled_emails (status, send_at);
create index if not exists crm_scheduled_emails_user_idx on public.crm_scheduled_emails (user_id, status, send_at);

alter table public.crm_scheduled_emails enable row level security;
revoke all on public.crm_scheduled_emails from anon, authenticated;
