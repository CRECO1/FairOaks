-- My Drive: Starred items kept per person ON THE SERVER (they used to live only in one browser, so phone and desktop disagreed).
--
-- One row per (person, item). key = '<kind>:<id>' with kind folder | doc | file | form. No FK to the item on purpose: a deleted item's
-- star is simply never shown. Service-role only (RLS on, no policies): the API reads / writes the caller's own rows.
--
-- Rollback:  drop table if exists public.crm_drive_stars;
-- Idempotent; safe to re-run.

create table if not exists public.crm_drive_stars (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null check (key ~ '^(folder|doc|file|form):[0-9a-f-]{36}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.crm_drive_stars enable row level security;
revoke all on public.crm_drive_stars from anon, authenticated;
