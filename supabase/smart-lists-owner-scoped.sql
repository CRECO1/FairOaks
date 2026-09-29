-- Saved lists: owner-scoped visibility, create-as-yourself, super-admin-only delete.
--
-- Before: a single RESTRICTIVE `using (false)` policy, so no browser session could touch
-- crm_smart_lists and every rule lived in /api/smart-lists — which returned every list
-- in the unit to everyone and let any admin delete. Zack's segments (brokers, market
-- report subscribers, the Elkhorn cuts, recruiting stages) were visible to every agent.
--
-- After, the same rules the route enforces:
--   SELECT  your own lists; the super-admin sees all of them
--   INSERT  only as yourself (created_by = auth.uid())
--   UPDATE  super-admin only (nothing in the app edits a saved list)
--   DELETE  super-admin only — agents and admins create lists but never remove them
--
-- created_by is the owner column; crm_is_super_admin() is the same SECURITY DEFINER
-- check that locks audit_logs. The route uses the service-role key and bypasses RLS,
-- so it enforces all of this itself as well.

drop policy if exists crm_smart_lists_service_only on public.crm_smart_lists;

create policy smart_lists_select_own_or_super on public.crm_smart_lists
  for select to authenticated
  using (created_by = (select auth.uid()) or public.crm_is_super_admin());

create policy smart_lists_insert_as_self on public.crm_smart_lists
  for insert to authenticated
  with check (created_by = (select auth.uid()));

create policy smart_lists_update_super_admin on public.crm_smart_lists
  for update to authenticated
  using (public.crm_is_super_admin())
  with check (public.crm_is_super_admin());

create policy smart_lists_delete_super_admin on public.crm_smart_lists
  for delete to authenticated
  using (public.crm_is_super_admin());

-- TRUNCATE is not subject to RLS; nobody outside the service role needs it (or
-- REFERENCES/TRIGGER). anon keeps no privileges at all.
revoke truncate, references, trigger on public.crm_smart_lists from authenticated;
revoke all on public.crm_smart_lists from anon;
