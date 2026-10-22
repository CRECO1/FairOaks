-- Call block list: numbers the inbound voice flow turns away (and the bot auto-adds on spam robocalls).
-- Additive + idempotent. NOT applied automatically — run via the pooler / SQL editor after review.
--
--   phone_key      last 10 digits (NANP) or the full digits (international) — what matching uses, so
--                  "(210) 555-0123", "+1 210-555-0123" and "12105550123" are all the same row.
--   business_unit  'all' (every line) | 'commercial' | 'residential'
--   source         'auto' (the AI receptionist flagged a spam robocall) | 'manual' (a person added it)
--
-- Access: the voice webhooks and /api/crm/call-blocklist use the service role. RLS is also on so a
-- direct PostgREST query only works for CRM staff (admin / super_admin / agent) — never anon.

create table if not exists crm_blocked_numbers (
  id              uuid primary key default gen_random_uuid(),
  phone_e164      text not null,
  phone_key       text not null,
  business_unit   text not null default 'all' check (business_unit in ('all', 'commercial', 'residential')),
  reason          text,
  source          text not null default 'manual' check (source in ('auto', 'manual')),
  created_by      uuid references crm_profiles(id) on delete set null,
  call_id         uuid references crm_call_log(id) on delete set null,
  hits            integer not null default 0,
  last_blocked_at timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists crm_blocked_numbers_key_unit on crm_blocked_numbers (phone_key, business_unit);
create index if not exists crm_blocked_numbers_created on crm_blocked_numbers (created_at desc);

-- SECURITY DEFINER so the policy doesn't re-enter crm_profiles' own RLS; search_path pinned.
create or replace function public.crm_blocklist_is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.crm_profiles where id = auth.uid() and role in ('admin', 'super_admin', 'agent'));
$$;
revoke all on function public.crm_blocklist_is_staff() from public, anon;
grant execute on function public.crm_blocklist_is_staff() to authenticated, service_role;

alter table crm_blocked_numbers enable row level security;

drop policy if exists crm_blocked_numbers_staff_read on crm_blocked_numbers;
create policy crm_blocked_numbers_staff_read on crm_blocked_numbers
  for select to authenticated using (public.crm_blocklist_is_staff());

drop policy if exists crm_blocked_numbers_staff_insert on crm_blocked_numbers;
create policy crm_blocked_numbers_staff_insert on crm_blocked_numbers
  for insert to authenticated with check (public.crm_blocklist_is_staff());

drop policy if exists crm_blocked_numbers_staff_delete on crm_blocked_numbers;
create policy crm_blocked_numbers_staff_delete on crm_blocked_numbers
  for delete to authenticated using (public.crm_blocklist_is_staff());
-- No UPDATE policy for authenticated: hit counters are bumped by the service role only.

-- Supabase grants every table to anon/authenticated by default. RLS already blocks anon, but TRUNCATE is
-- not subject to RLS, so keep the grants to exactly what the policies allow.
revoke all on crm_blocked_numbers from anon, authenticated;
grant select, insert, delete on crm_blocked_numbers to authenticated;
