-- RLS: wrap per-row function calls in (SELECT …) — evaluated once per statement. Semantics-neutral (functions are STABLE).
-- Generated 2026-10-12; pre-change policies backed up in Backups/rls-wrap-2026-10-12/policies-before.json
ALTER POLICY "activity_delete_super_admin" ON public.crm_activity USING ((SELECT crm_is_super_admin()));
ALTER POLICY "activity_unit_insert" ON public.crm_activity WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "activity_unit_select" ON public.crm_activity USING (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "activity_unit_update" ON public.crm_activity USING (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu())))) WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "campaign_sends_owner_scoped" ON public.crm_campaign_sends USING (((SELECT crm_is_super_admin()) OR (EXISTS ( SELECT 1
   FROM crm_campaigns k
  WHERE ((k.id = crm_campaign_sends.campaign_id) AND (k.business_unit = (SELECT crm_current_bu())) AND ((k.created_by = ( SELECT auth.uid() AS uid)) OR (k.sender_agent_id = ( SELECT auth.uid() AS uid))))))));
ALTER POLICY "campaigns_unit_insert" ON public.crm_campaigns WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "campaigns_unit_select" ON public.crm_campaigns USING (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "campaigns_unit_update" ON public.crm_campaigns USING (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu())))) WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "client_activities_unit_all" ON public.crm_client_activities USING (((SELECT crm_is_admin()) OR (EXISTS ( SELECT 1
   FROM crm_clients c
  WHERE ((c.id = crm_client_activities.client_id) AND (c.business_unit = (SELECT crm_current_bu()))))))) WITH CHECK (((SELECT crm_is_admin()) OR (EXISTS ( SELECT 1
   FROM crm_clients c
  WHERE ((c.id = crm_client_activities.client_id) AND (c.business_unit = (SELECT crm_current_bu())))))));
ALTER POLICY "crm_client_activities_insert" ON public.crm_client_activities WITH CHECK ((agent_id = (SELECT auth.uid())));
ALTER POLICY "crm_client_activities_select" ON public.crm_client_activities USING (((agent_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM crm_profiles p
  WHERE ((p.id = (SELECT auth.uid())) AND (p.role = 'admin'::text)))) OR (EXISTS ( SELECT 1
   FROM crm_clients c
  WHERE ((c.id = crm_client_activities.client_id) AND ((c.agent_id = (SELECT auth.uid())) OR ((SELECT auth.uid()) = ANY (c.assigned_agent_ids))))))));
ALTER POLICY "clients_unit_insert" ON public.crm_clients WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "clients_unit_select" ON public.crm_clients USING (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "clients_unit_update" ON public.crm_clients USING (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu())))) WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
ALTER POLICY "crm_clients delete super admin only" ON public.crm_clients USING ((SELECT crm_is_super_admin()));
ALTER POLICY "crm_clients_insert" ON public.crm_clients WITH CHECK (((SELECT auth.uid()) = agent_id));
ALTER POLICY "crm_clients_select" ON public.crm_clients USING (((( SELECT auth.uid() AS uid) = agent_id) OR (( SELECT auth.uid() AS uid) = ANY (assigned_agent_ids)) OR (is_shared = true) OR (SELECT crm_is_admin())));
ALTER POLICY "crm_clients_update" ON public.crm_clients USING (((( SELECT auth.uid() AS uid) = agent_id) OR (SELECT crm_is_admin())));
ALTER POLICY "deals_admin_delete" ON public.crm_deals USING ((SELECT crm_is_admin()));
ALTER POLICY "deals_scoped_insert" ON public.crm_deals WITH CHECK (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (agent_id = (SELECT auth.uid()))))));
ALTER POLICY "deals_scoped_select" ON public.crm_deals USING (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (agent_id = (SELECT auth.uid())) OR ((SELECT auth.uid()) = ANY (COALESCE(assigned_agent_ids, '{}'::uuid[])))))));
ALTER POLICY "deals_scoped_update" ON public.crm_deals USING (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (agent_id = (SELECT auth.uid())) OR ((SELECT auth.uid()) = ANY (COALESCE(assigned_agent_ids, '{}'::uuid[]))))))) WITH CHECK (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (agent_id = (SELECT auth.uid())) OR ((SELECT auth.uid()) = ANY (COALESCE(assigned_agent_ids, '{}'::uuid[])))))));
ALTER POLICY "note_history_read" ON public.crm_note_history USING ((SELECT crm_has_profile()));
ALTER POLICY "crm_property_tenants authenticated" ON public.crm_property_tenants USING ((SELECT crm_has_profile())) WITH CHECK ((SELECT crm_has_profile()));
ALTER POLICY "prospective_properties delete super admin only" ON public.crm_prospective_properties USING ((SELECT crm_is_super_admin()));
ALTER POLICY "prospective_properties select" ON public.crm_prospective_properties USING ((SELECT crm_has_profile()));
ALTER POLICY "tasks_admin_delete" ON public.crm_tasks USING ((SELECT crm_is_admin()));
ALTER POLICY "tasks_scoped_select" ON public.crm_tasks USING (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (assigned_to = (SELECT auth.uid())) OR (agent_id = (SELECT auth.uid())) OR (created_by = (SELECT auth.uid()))))));
ALTER POLICY "tasks_scoped_update" ON public.crm_tasks USING (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (assigned_to = (SELECT auth.uid())) OR (agent_id = (SELECT auth.uid())) OR (created_by = (SELECT auth.uid())))))) WITH CHECK (((SELECT crm_is_admin()) OR ((business_unit = (SELECT crm_current_bu())) AND ((NOT (SELECT crm_is_agent())) OR (assigned_to = (SELECT auth.uid())) OR (agent_id = (SELECT auth.uid())) OR (created_by = (SELECT auth.uid()))))));
ALTER POLICY "tasks_unit_insert" ON public.crm_tasks WITH CHECK (((SELECT crm_is_admin()) OR (business_unit = (SELECT crm_current_bu()))));
