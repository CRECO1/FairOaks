-- Speed-to-lead reminders (cron/lead-sla): one row per reminder level sent
-- per lead, so each nudge/escalation goes out at most once.
-- Service-role only: RLS on, no policies.
create table if not exists public.crm_lead_sla_alerts (
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  level smallint not null check (level in (1, 2)),
  sent_to text[],
  sent_at timestamptz not null default now(),
  primary key (client_id, level)
);
alter table public.crm_lead_sla_alerts enable row level security;
revoke all on public.crm_lead_sla_alerts from anon, authenticated;
