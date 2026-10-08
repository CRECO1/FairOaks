-- Action-plan sends only kept the FIRST open time (opened_at). The History tab's "Latest open" order needs the most recent one.
-- The open pixel now stamps last_opened_at on every open; existing rows are backfilled with their first-open time (best known).
alter table public.crm_action_plan_sends add column if not exists last_opened_at timestamptz;
update public.crm_action_plan_sends set last_opened_at = opened_at where opened_at is not null and last_opened_at is null;
