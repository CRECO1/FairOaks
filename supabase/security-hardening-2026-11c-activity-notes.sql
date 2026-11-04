-- Contact activity notes: stop cross-workspace and spoofed-author inserts (2026-11-04 audit follow-up).
-- crm_client_activities: the permissive "insert" policy only checked agent_id = me, so a note could be attached to ANY contact in ANY
--   workspace (policies are OR'd with the workspace policy). The "ALL" workspace policy also let a note be written under another agent's
--   name. Replaced by explicit per-command policies: insert = my own name AND a contact in my workspace (admins: any).
-- crm_activity: insert only checked the row's own business_unit column, which the caller sets; a restrictive policy now also requires the
--   contact to be in the caller's workspace (admins: any).
begin;

drop policy if exists crm_client_activities_insert on public.crm_client_activities;
drop policy if exists client_activities_unit_all on public.crm_client_activities;

create policy client_activities_unit_read on public.crm_client_activities for select to authenticated
  using ((select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = (select public.crm_current_bu())));

create policy client_activities_unit_update on public.crm_client_activities for update to authenticated
  using ((select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = (select public.crm_current_bu())))
  with check ((select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = (select public.crm_current_bu())));

create policy client_activities_unit_delete on public.crm_client_activities for delete to authenticated
  using ((select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = (select public.crm_current_bu())));

create policy client_activities_unit_insert on public.crm_client_activities for insert to authenticated
  with check (
    agent_id = (select auth.uid())
    and ((select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_client_activities.client_id and c.business_unit = (select public.crm_current_bu())))
  );

drop policy if exists activity_client_in_bu_insert on public.crm_activity;
create policy activity_client_in_bu_insert on public.crm_activity as restrictive for insert to authenticated
  with check (client_id is null or (select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_activity.client_id and c.business_unit = (select public.crm_current_bu())));

drop policy if exists activity_client_in_bu_update on public.crm_activity;
create policy activity_client_in_bu_update on public.crm_activity as restrictive for update to authenticated
  with check (client_id is null or (select public.crm_is_admin()) or exists (select 1 from public.crm_clients c where c.id = crm_activity.client_id and c.business_unit = (select public.crm_current_bu())));

commit;

-- Rollback: recreate  "crm_client_activities_insert" (insert, with check agent_id = auth.uid()) and "client_activities_unit_all" (ALL, workspace expr);
--           drop the new client_activities_unit_* and activity_client_in_bu_* policies.
