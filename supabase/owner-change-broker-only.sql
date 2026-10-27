-- Only the account owner (super_admin) may change who OWNS a deal or a contact. Brian (admin) cannot: the CRM hides the controls,
-- the owner routes 403, and this makes the database refuse it too (a direct API call from a logged-in admin session).
-- Server code (service role: lead routing, call-list assignment by Zack, merges, crons) has auth.uid() null and is unaffected.
-- Agents adding/removing teammates on a deal (assigned_agent_ids) is a different column and stays allowed.

create or replace function public.crm_owner_change_broker_only()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.crm_is_super_admin() and new.agent_id is distinct from old.agent_id then
    new.agent_id := old.agent_id;
  end if;
  return new;
end $$;

drop trigger if exists zz_crm_deals_owner_broker_only on public.crm_deals;
create trigger zz_crm_deals_owner_broker_only before update on public.crm_deals
  for each row execute function public.crm_owner_change_broker_only();

drop trigger if exists zz_crm_clients_owner_broker_only on public.crm_clients;
create trigger zz_crm_clients_owner_broker_only before update on public.crm_clients
  for each row execute function public.crm_owner_change_broker_only();
