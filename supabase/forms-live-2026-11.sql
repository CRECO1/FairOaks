-- Live forms: several people fill the same transaction form (TREC / TXR / lease …) at the same time.
--
-- Nothing is stored in new tables — the blanks are shared over Supabase Realtime *private* broadcast channels named
--   form-doc:<submission id>
-- and the saved copy is still crm_form_submissions, written by "Save to deal" exactly as before. This file only adds the rule for who
-- may join a form's channel: the SAME rule the forms API applies (CRM profile; workspace for non-admins; a linked deal must not be
-- hidden from the person — Restricted deals need owner/assigned, agents must be on the deal; a linked property must exist and, when
-- Restricted, the person must be its listing agent or assigned). It mirrors lib/crm-auth.ts (assertOwnsResource / hiddenDealIds) and
-- lib/crm-linked-access.ts (canAccessLinked). crm_form_submissions has no row-level read rule of its own (the API reads it with the
-- service role), so this function is the database-side copy of that logic — keep the two in step.
--
-- Rollback (nothing else references them):
--   drop policy if exists form_docs_rt_receive on realtime.messages;
--   drop policy if exists form_docs_rt_send on realtime.messages;
--   drop function if exists public.crm_form_topic_ok(text);
--   drop function if exists public.crm_form_access(uuid);
--   drop function if exists public.crm_form_can(uuid, uuid);
-- Idempotent; safe to re-run.

create or replace function public.crm_form_can(p_uid uuid, p_sub uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  pr record; s record; d record; l record;
  is_admin boolean; on_deal boolean;
begin
  select role, business_unit into pr from public.crm_profiles where id = p_uid;
  if not found then return false; end if;
  select business_unit, deal_id, listing_id into s from public.crm_form_submissions where id = p_sub;
  if not found then return false; end if;
  if pr.role = 'super_admin' then return true; end if;
  is_admin := pr.role = 'admin';
  if not is_admin and s.business_unit is distinct from pr.business_unit then return false; end if;

  if s.deal_id is not null then
    select agent_id, assigned_agent_ids, is_restricted into d from public.crm_deals where id = s.deal_id;
    if found then
      on_deal := d.agent_id = p_uid or p_uid = any (coalesce(d.assigned_agent_ids, '{}'::uuid[]));
      if coalesce(d.is_restricted, false) and not on_deal then return false; end if;   -- a private deal that isn't yours (admins too)
      if not is_admin and not on_deal then return false; end if;                          -- agents see only deals they are on
    end if;
  end if;

  if s.listing_id is not null then
    select business_unit, listing_agent_id, assigned_agent_ids, is_restricted into l from public.crm_listings where id = s.listing_id;
    if not found then return false; end if;                                              -- same as the API: a missing property is "no access"
    if not is_admin then
      if l.business_unit is distinct from pr.business_unit then return false; end if;
      if coalesce(l.is_restricted, false)
         and not (l.listing_agent_id = p_uid or p_uid = any (coalesce(l.assigned_agent_ids, '{}'::uuid[]))) then return false; end if;
    end if;
  end if;
  return true;
end
$$;
revoke all on function public.crm_form_can(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_form_can(uuid, uuid) to service_role;

create or replace function public.crm_form_access(p_sub uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_form_can(auth.uid(), p_sub);
$$;
revoke all on function public.crm_form_access(uuid) from public, anon;
grant execute on function public.crm_form_access(uuid) to authenticated, service_role;

create or replace function public.crm_form_topic_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null or p_topic !~ '^form-doc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.crm_form_access(substr(p_topic, 10)::uuid);
end
$$;
revoke all on function public.crm_form_topic_ok(text) from public, anon;
grant execute on function public.crm_form_topic_ok(text) to authenticated, service_role;

drop policy if exists form_docs_rt_receive on realtime.messages;
create policy form_docs_rt_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.crm_form_topic_ok((select realtime.topic())));

drop policy if exists form_docs_rt_send on realtime.messages;
create policy form_docs_rt_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.crm_form_topic_ok((select realtime.topic())));
