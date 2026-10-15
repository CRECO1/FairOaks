-- The Copilot's chat log, kept per agent for 24 hours so it follows them across devices.
-- Written/read only by /api/crm/assistant/chat on the service role: RLS on, no policies.
create table if not exists public.crm_copilot_chats (
  user_id     uuid primary key,
  messages    jsonb not null default '[]'::jsonb,
  stamps      jsonb not null default '[]'::jsonb,
  pending     jsonb,
  pending_at  timestamptz,
  updated_at  timestamptz not null default now()
);
alter table public.crm_copilot_chats enable row level security;
create index if not exists crm_copilot_chats_updated_idx on public.crm_copilot_chats (updated_at);
