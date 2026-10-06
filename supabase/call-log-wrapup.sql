-- Calling Log: call wrap-ups, who answered, and call-back SLA reminders (2026-10-06).
--
--  outcome / wrapped_at / wrapped_by — the 10-second wrap-up an agent gives an
--    answered call (what it was, plus a note). Before this, 28 human-answered
--    calls since August had no record of what was discussed.
--  answered_by — which agent picked up a Talkroute call (from its call events), so
--    a missing wrap-up is nudged to the right person.
--  answered_by_bot — the Talkroute leg of a call the AI receptionist picked up.
--    The bot's own row already carries the transcript and summary, so this leg is
--    hidden from the log instead of showing every bot call twice.
--  crm_call_sla_alerts — the 30-minute / 2-hour call-back reminders, sent once
--    per level per call (mirrors crm_lead_sla_alerts for web leads).

alter table crm_call_log add column if not exists outcome text;
alter table crm_call_log drop constraint if exists crm_call_log_outcome_check;
alter table crm_call_log add constraint crm_call_log_outcome_check
  check (outcome is null or outcome in ('new_lead', 'client', 'tenant', 'vendor', 'spam', 'personal', 'other'));
alter table crm_call_log add column if not exists wrapped_at timestamptz;
alter table crm_call_log add column if not exists wrapped_by uuid references crm_profiles(id) on delete set null;
alter table crm_call_log add column if not exists answered_by uuid references crm_profiles(id) on delete set null;
alter table crm_call_log add column if not exists answered_by_bot boolean not null default false;

create index if not exists crm_call_log_needs_wrapup_idx
  on crm_call_log (business_unit, started_at desc)
  where wrapped_at is null and answered_by_bot = false;

create table if not exists crm_call_sla_alerts (
  call_id uuid not null references crm_call_log(id) on delete cascade,
  level int not null,
  sent_to text[] not null default '{}',
  sent_at timestamptz not null default now(),
  primary key (call_id, level)
);
alter table crm_call_sla_alerts enable row level security;
