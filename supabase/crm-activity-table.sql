-- crm_activity — per-client activity/event log.
--
-- APPLIED TO PRODUCTION 2026-08-07 (migration: create_crm_activity_event_log).
-- Kept here so the schema lives in the repo alongside rls-workspace-isolation.sql
-- and rbac-super-admin.sql.
--
-- Background: six call sites read from or write to public.crm_activity —
--   src/app/api/crm/clients/[id]/timeline/route.ts   (select)
--   src/app/api/cron/action-plans/route.ts           (insert x2)
--   src/app/api/action-plans/[id]/send-now/route.ts  (insert x2)
--   src/app/api/action-plans/stage-trigger/route.ts  (insert)
--   src/app/api/email-leads/sync/route.ts            (insert)
--   src/components/crm/CRMApp.tsx                    (select, agent activity stats)
-- but the table had never been created. supabase-js returns errors rather than
-- throwing, and none of those call sites check, so every write failed silently and
-- client timelines always rendered zero activity events.
--
-- NOT to be confused with crm_activity_logs, which is an unrelated daily prospecting
-- scoreboard (log_date, prospecting_calls, door_touches, tours_meetings, ...) with no
-- client_id and no event type.

create table if not exists public.crm_activity (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid references public.crm_clients(id)  on delete cascade,
  agent_id      uuid references public.crm_profiles(id) on delete set null,
  type          text not null default 'note',   -- call | email | sms | meeting | task | note
  notes         text,
  business_unit text,
  created_at    timestamptz not null default now()
);

comment on table public.crm_activity is
  'Per-client activity events (call/email/sms/meeting/task/note). Distinct from crm_activity_logs, which is a daily prospecting scoreboard.';

-- The timeline route embeds agent:crm_profiles(first_name,last_name); PostgREST needs
-- the agent_id foreign key above to infer that relationship.

create index if not exists crm_activity_client_id_created_at_idx
  on public.crm_activity (client_id, created_at desc);
create index if not exists crm_activity_created_at_idx
  on public.crm_activity (created_at desc);
create index if not exists crm_activity_agent_id_idx
  on public.crm_activity (agent_id);

-- Callers insert only {client_id, agent_id, type, notes}, so business_unit is
-- denormalised from the client on write. That keeps the RLS predicate a cheap column
-- comparison — matching crm_clients / crm_deals — without touching application code.
create or replace function public.crm_activity_set_business_unit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.business_unit is null and new.client_id is not null then
    select c.business_unit into new.business_unit
    from public.crm_clients c where c.id = new.client_id;
  end if;
  return new;
end $$;

drop trigger if exists crm_activity_business_unit_trg on public.crm_activity;
create trigger crm_activity_business_unit_trg
  before insert on public.crm_activity
  for each row execute function public.crm_activity_set_business_unit();

-- Workspace isolation, mirroring crm_deals / crm_clients. The API routes use the
-- service role and bypass RLS; these policies constrain the direct browser reads in
-- CRMApp.tsx.
alter table public.crm_activity enable row level security;

drop policy if exists activity_unit_select on public.crm_activity;
create policy activity_unit_select on public.crm_activity
  for select to authenticated
  using (crm_is_admin() or business_unit = crm_current_bu());

drop policy if exists activity_unit_insert on public.crm_activity;
create policy activity_unit_insert on public.crm_activity
  for insert to authenticated
  with check (crm_is_admin() or business_unit = crm_current_bu());

drop policy if exists activity_unit_update on public.crm_activity;
create policy activity_unit_update on public.crm_activity
  for update to authenticated
  using (crm_is_admin() or business_unit = crm_current_bu())
  with check (crm_is_admin() or business_unit = crm_current_bu());

drop policy if exists activity_delete_super_admin on public.crm_activity;
create policy activity_delete_super_admin on public.crm_activity
  for delete to authenticated
  using (crm_is_super_admin());
