-- Per-agent daily call goal (call queue). Additive + idempotent; safe to run any time, before or after deploy.
-- Until it runs, the CRM falls back to the per-device goal (localStorage) and toasts once on save.
-- Existing agents' goals are adopted automatically from whichever device they next open the queue on.
-- Agents already update their own crm_profiles row (last_sign_in_at), so no policy change is needed.
alter table public.crm_profiles
  add column if not exists daily_call_goal integer
  check (daily_call_goal is null or (daily_call_goal > 0 and daily_call_goal < 1000));
comment on column public.crm_profiles.daily_call_goal is 'Agent''s daily call goal shown on the call queue; null = default 25.';
