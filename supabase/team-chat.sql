-- TeamChat: internal messages between teammates (a team room per workspace + 1-to-1 direct messages).
-- Service-only tables: RLS is on with NO policies, so nothing reads or writes them except the /api/crm/chat routes,
-- which check the caller's workspace and (for direct messages) that the caller is one of the two people.
create table if not exists public.crm_chat_messages (
  id uuid primary key default gen_random_uuid(),
  business_unit text not null,
  room text not null,                       -- 'team'  or  'dm:<smaller profile id>:<larger profile id>'
  sender_id uuid not null references public.crm_profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists crm_chat_messages_room_idx on public.crm_chat_messages (business_unit, room, created_at desc);
create table if not exists public.crm_chat_reads (
  user_id uuid not null references public.crm_profiles(id) on delete cascade,
  room text not null,
  last_read_at timestamptz not null default now(),
  primary key (user_id, room)
);
alter table public.crm_chat_messages enable row level security;
alter table public.crm_chat_reads enable row level security;
revoke all on public.crm_chat_messages, public.crm_chat_reads from anon, authenticated;
