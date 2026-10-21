-- Calling Log — agent-chosen call-back time.
--
-- follow_up_due alone can't say "an agent picked this": tidyCallLog fills it with a
-- 2-business-hour default for any undated call-back, and the voice bot writes the
-- caller's own time into it. callback_chosen_at is set (to the moment of the pick) only
-- when an agent chooses the time in the Calling Log. runCallbackSla fires those calls at
-- follow_up_due instead of the 30-minute / 2-hour business-minute cadence, and sends
-- the owner + backup escalation if still open 2 business hours after that time.
--
-- Alert levels in crm_call_sla_alerts (no schema change — level is a plain int):
--   0 instant missed-call · 1 30-min nudge · 2 2-hour escalation
--   3 chosen-time reminder · 4 escalation after a chosen time
--
-- APPLY BEFORE DEPLOYING the code: runCallbackSla selects this column.

alter table public.crm_call_log
  add column if not exists callback_chosen_at timestamptz;

create index if not exists crm_call_log_chosen_due_idx
  on public.crm_call_log (follow_up_due)
  where needs_follow_up and handled_at is null and callback_chosen_at is not null;
