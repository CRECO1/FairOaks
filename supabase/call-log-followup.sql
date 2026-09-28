-- Calling Log — actionable call-back queue.
--
-- A "needs call back" flag on crm_call_log was a flat boolean: no due time, no
-- owner, no aging. These columns turn it into a real queue — each call-back can
-- carry a due time and an assigned agent, and the daily task-reminders cron nags
-- on the ones that go overdue.
--
-- The call row stays the single source of truth (we do NOT mirror call-backs into
-- crm_tasks); the reminder cron reads these columns directly.

alter table public.crm_call_log
  add column if not exists follow_up_due      timestamptz,
  add column if not exists follow_up_assignee uuid references public.crm_profiles(id) on delete set null;

-- Only open call-backs are ever queried by due date; a partial index keeps it tiny.
create index if not exists crm_call_log_followup_due_idx
  on public.crm_call_log (follow_up_due)
  where needs_follow_up and handled_at is null;
