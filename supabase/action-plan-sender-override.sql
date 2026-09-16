-- Per-plan sender override for action-plan emails.
-- Lets a plan send as a specific person (e.g. a named broker) instead of the brand
-- address. Honored at send time ONLY when the address is on the business unit's own
-- verified Resend domain — see src/lib/action-plan-from.ts (resolveActionPlanFrom).
-- Null on every existing plan, so their sends fall back to the brand address unchanged.
alter table crm_action_plans
  add column if not exists from_name  text,
  add column if not exists from_email text;
