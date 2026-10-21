-- New-lead hold (2026-10-21, Zack: "assign all new leads to me before Brian can see them").
--
-- A contact created from an inbound-lead source (website forms, Elkhorn site, phone bot, lead-alert emails, Crexi/LoopNet/CoStar…)
-- is created HELD: owned by the broker (the one super_admin) and invisible to everyone else — Contacts, search, tasks, activity,
-- call log — until the broker hands it to someone (changing the owner releases it) or releases it by hand.
-- Service-role server code (webhooks, crons, Copilot) bypasses RLS: those paths filter on lead_hold themselves.
-- Idempotent. Undo with supabase/lead-hold-rollback.sql.

alter table public.crm_clients add column if not exists lead_hold boolean not null default false;
alter table public.crm_clients add column if not exists lead_hold_at timestamptz;
alter table public.crm_clients add column if not exists lead_released_at timestamptz;
create index if not exists crm_clients_lead_hold_idx on public.crm_clients (lead_hold) where lead_hold;

-- Is this contact held? SECURITY DEFINER so the answer does not depend on what the caller may see.
create or replace function public.crm_client_held(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lead_hold from public.crm_clients where id = cid), false)
$$;

-- Insert: an inbound-lead source starts held, owned by the broker.
create or replace function public.crm_clients_lead_hold_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare zid uuid; n int;
begin
  if new.lead_hold is not true
     and coalesce(new.lead_source, '') ~* '^(website|creco website|elkhorn|phone \(voice bot\)|phone call|listing alerts|crexi|loopnet|costar|42floors|zillow|realtor\.com|email — )' then
    select count(*), min(id::text)::uuid into n, zid from public.crm_profiles where role = 'super_admin';
    if n = 1 then
      new.lead_hold := true; new.lead_hold_at := now(); new.agent_id := zid;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists aa_crm_clients_lead_hold_insert on public.crm_clients;
create trigger aa_crm_clients_lead_hold_insert before insert on public.crm_clients
  for each row execute function public.crm_clients_lead_hold_insert();

-- Update: only the broker flips the hold by hand; giving the lead to anyone else releases it.
create or replace function public.crm_clients_lead_hold_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare zid uuid;
begin
  if old.lead_hold then
    if new.lead_hold is distinct from old.lead_hold and auth.uid() is not null and not public.crm_is_super_admin() then
      new.lead_hold := old.lead_hold;
    end if;
    select id into zid from public.crm_profiles where role = 'super_admin' limit 1;
    if new.lead_hold and new.agent_id is distinct from old.agent_id and new.agent_id is distinct from zid then
      new.lead_hold := false;
    end if;
    if not new.lead_hold then new.lead_released_at := now(); end if;
  elsif new.lead_hold and auth.uid() is not null and not public.crm_is_super_admin() then
    new.lead_hold := false;   -- nobody else may put a contact on hold
  end if;
  return new;
end $$;
drop trigger if exists aa_crm_clients_lead_hold_update on public.crm_clients;
create trigger aa_crm_clients_lead_hold_update before update on public.crm_clients
  for each row execute function public.crm_clients_lead_hold_update();

-- Visibility. RESTRICTIVE = ANDed with every existing policy, so nothing else needs to change.
drop policy if exists lead_hold_hide on public.crm_clients;
create policy lead_hold_hide on public.crm_clients as restrictive for all to authenticated
  using (not lead_hold or (select public.crm_is_super_admin()) or agent_id = (select auth.uid()));

drop policy if exists lead_hold_hide on public.crm_tasks;
create policy lead_hold_hide on public.crm_tasks as restrictive for all to authenticated
  using (client_id is null or not public.crm_client_held(client_id) or (select public.crm_is_super_admin()));
drop policy if exists lead_hold_hide on public.crm_activity;
create policy lead_hold_hide on public.crm_activity as restrictive for all to authenticated
  using (client_id is null or not public.crm_client_held(client_id) or (select public.crm_is_super_admin()));
drop policy if exists lead_hold_hide on public.crm_client_activities;
create policy lead_hold_hide on public.crm_client_activities as restrictive for all to authenticated
  using (client_id is null or not public.crm_client_held(client_id) or (select public.crm_is_super_admin()));
drop policy if exists lead_hold_hide on public.crm_call_log;
create policy lead_hold_hide on public.crm_call_log as restrictive for all to authenticated
  using (contact_id is null or not public.crm_client_held(contact_id) or (select public.crm_is_super_admin()));
