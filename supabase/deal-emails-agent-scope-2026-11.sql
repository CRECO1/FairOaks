-- Deal emails: an agent reads/writes emails logged on a deal only if they are on the deal (owner or in assigned_agent_ids).
--
-- Why (Zack, 2026-11-02): "I don't want other agents to see [a deal] unless they are added as an agent in there."
-- The permissive policy `deal_emails_unit_all` let ANY user in the same workspace read a deal-linked email whenever the
-- email row also carried a contact (client_id) in that workspace — so an agent could read emails on a colleague's deal.
-- It is replaced by a policy that follows the deal. Emails with NO deal (logged on a contact only) stay visible
-- across the workspace exactly as before; admins and the super admin still see everything.
--
-- Rollback (restores the old behaviour):
--   drop policy if exists deal_emails_unit_scoped on public.crm_deal_emails;
--   create policy deal_emails_unit_all on public.crm_deal_emails as permissive for all to public
--     using (crm_is_admin() or exists (select 1 from crm_deals d where d.id = crm_deal_emails.deal_id and d.business_unit = crm_current_bu())
--            or exists (select 1 from crm_clients c where c.id = crm_deal_emails.client_id and c.business_unit = crm_current_bu()))
--     with check (crm_is_admin() or exists (select 1 from crm_deals d where d.id = crm_deal_emails.deal_id and d.business_unit = crm_current_bu())
--            or exists (select 1 from crm_clients c where c.id = crm_deal_emails.client_id and c.business_unit = crm_current_bu()));
-- Idempotent; safe to re-run. (The RESTRICTIVE policy restricted_deal_follow, which hides private deals, is untouched.)

drop policy if exists deal_emails_unit_all on public.crm_deal_emails;
drop policy if exists deal_emails_unit_scoped on public.crm_deal_emails;

create policy deal_emails_unit_scoped on public.crm_deal_emails
  as permissive for all to public
  using (
    crm_is_admin()
    or (deal_id is not null and exists (
          select 1 from public.crm_deals d
          where d.id = crm_deal_emails.deal_id
            and (d.agent_id = auth.uid() or auth.uid() = any (coalesce(d.assigned_agent_ids, '{}'::uuid[])))))
    or (deal_id is null and exists (
          select 1 from public.crm_clients c
          where c.id = crm_deal_emails.client_id and c.business_unit = crm_current_bu()))
  )
  with check (
    crm_is_admin()
    or (deal_id is not null and exists (
          select 1 from public.crm_deals d
          where d.id = crm_deal_emails.deal_id
            and (d.agent_id = auth.uid() or auth.uid() = any (coalesce(d.assigned_agent_ids, '{}'::uuid[])))))
    or (deal_id is null and exists (
          select 1 from public.crm_clients c
          where c.id = crm_deal_emails.client_id and c.business_unit = crm_current_bu()))
  );
