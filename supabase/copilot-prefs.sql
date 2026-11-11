-- What each agent has asked the Copilot to remember between chats (standing preferences).
-- Written/read only by the Copilot on the service role: RLS on, no policies.
-- Until this table exists the Copilot simply has no remember/forget tools (lib/copilot-prefs returns null).
create table if not exists public.crm_copilot_prefs (
  user_id     uuid primary key,
  prefs       jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.crm_copilot_prefs enable row level security;
