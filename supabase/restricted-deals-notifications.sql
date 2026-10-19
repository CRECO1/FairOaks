-- Notifications about a private deal are never delivered to someone who can't see the deal
-- (a @mention in a private deal's notes would otherwise leak the property/client name).
-- Applies to every insert path (browser, server routes, cron) because it lives in the table.
-- Companion to restricted-deals.sql.
create or replace function public.crm_notifications_skip_private()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.entity_type = 'deal' and new.entity_id is not null and exists (
    select 1 from public.crm_deals d
    where d.id::text = new.entity_id::text
      and coalesce(d.is_restricted, false)
      and new.recipient_id is distinct from d.agent_id
      and not (new.recipient_id = any (coalesce(d.assigned_agent_ids, '{}'::uuid[])))
      and not exists (select 1 from public.crm_profiles p where p.id = new.recipient_id and p.role = 'super_admin')
  ) then
    return null; -- silently drop
  end if;
  return new;
end $$;

drop trigger if exists crm_notifications_skip_private on public.crm_notifications;
create trigger crm_notifications_skip_private before insert on public.crm_notifications
  for each row execute function public.crm_notifications_skip_private();
