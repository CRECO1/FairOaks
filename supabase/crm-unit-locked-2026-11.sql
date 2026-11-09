-- Per-profile workspace lock. An admin is normally free to switch between the CRECO and Fair Oaks workspaces;
-- unit_locked pins one profile to its own business_unit (UI-level, like the agent lock). Only a super admin can change it.
begin;
alter table public.crm_profiles add column if not exists unit_locked boolean not null default false;

create or replace function public.crm_guard_unit_locked() returns trigger
  language plpgsql security definer set search_path to 'public'
as $$
begin
  if auth.uid() is null then return new; end if;          -- service role / trusted server
  if tg_op = 'INSERT' then
    if new.unit_locked and not public.crm_is_super_admin() then new.unit_locked := false; end if;
  elsif new.unit_locked is distinct from old.unit_locked and not public.crm_is_super_admin() then
    raise exception 'Only a super admin can change a workspace lock';
  end if;
  return new;
end $$;
drop trigger if exists aa_crm_guard_unit_locked on public.crm_profiles;
create trigger aa_crm_guard_unit_locked before insert or update on public.crm_profiles
  for each row execute function public.crm_guard_unit_locked();

update public.crm_profiles set unit_locked = true where email = 'info@fairoaksrealtygroup.com' and business_unit = 'residential';
commit;
