-- crm_campaign_sends: scope recipient data to the people it belongs to.
--
-- THE HOLE. Three permissive policies OR'd together, and the widest won:
--   "auth users read sends"   SELECT, using (exists(select 1 from crm_profiles
--                             where id = auth.uid()))  -- i.e. "you are logged in"
-- Measured before this migration: Ed, an agent, read all 243 send rows —
-- including the recipient list of every Elkhorn campaign, which is the owner's
-- own outreach. Brian read all 243 too.
--
-- TWO MORE, found while fixing the first:
--   "campaign_sends_unit_all" is cmd=ALL, not SELECT — so an agent could UPDATE
--   and DELETE send records for any campaign in their business unit, silently
--   rewriting campaign history. It also granted every admin blanket access via
--   crm_is_admin().
--   "service role insert sends" is roles={public} with check(true) — despite the
--   name it let ANY authenticated user insert forged send rows. The service role
--   never needed it: it bypasses RLS entirely.
--
-- WHO ACTUALLY WRITES. cron/campaigns inserts, track/open updates, the Resend
-- webhook reads — all three use the service-role key and bypass RLS. The only
-- client-side access is CRMApp.tsx, which SELECTs (a contact's send history and
-- a campaign's send list) and never writes. So a single SELECT policy is the
-- entire legitimate surface; every write policy here was dead weight that only
-- created risk.
--
-- THE RULE. The owner sees every send. Everyone else sees sends for campaigns
-- they own — the ones they created or are the named sender of — and only within
-- their own business unit. Mirrors the audit_logs lock: the owner's own work is
-- the owner's.
--
-- Effect on today's data: Zack 243 (all campaigns are his), Ed 20 (he is the
-- sender on four of them), Brian 0 (he owns one campaign, which has no sends).
-- Ed keeps exactly the outreach that goes out under his own name.

drop policy if exists "auth users read sends"      on public.crm_campaign_sends;
drop policy if exists "campaign_sends_unit_all"    on public.crm_campaign_sends;
drop policy if exists "service role insert sends"  on public.crm_campaign_sends;
drop policy if exists campaign_sends_owner_scoped  on public.crm_campaign_sends;

create policy campaign_sends_owner_scoped
on public.crm_campaign_sends
for select
to authenticated
using (
  public.crm_is_super_admin()
  or exists (
    select 1 from public.crm_campaigns k
    where k.id = crm_campaign_sends.campaign_id
      and k.business_unit = public.crm_current_bu()
      and (k.created_by = (select auth.uid()) or k.sender_agent_id = (select auth.uid()))
  )
);

-- No write policy: with RLS on and none present, anon and authenticated are
-- denied every INSERT/UPDATE/DELETE regardless of grants. The service role is
-- unaffected.

-- Least privilege on the grants, same as the audit_logs pass. anon had full DML
-- on the send history; nothing reads or writes this table with the anon key.
revoke all on table public.crm_campaign_sends from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.crm_campaign_sends from authenticated;
grant select on table public.crm_campaign_sends to authenticated;
grant all on table public.crm_campaign_sends to service_role;
