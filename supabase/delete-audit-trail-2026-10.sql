-- Deal + contact DELETE audit trail.
--
-- THE GAP. Deleting a deal (any admin, from the deal card) or a contact (the owner,
-- from the contacts list) left no record at all: no who, no when, and no copy of
-- what was removed. On 2026-10-27 eight deals vanished and nothing could say who
-- removed them or what was in them. A deal delete also CASCADES to its emails,
-- documents, forms, meetings and commissions, so a mistake is unrecoverable
-- unless a backup happens to exist.
--
-- THE FIX. A BEFORE DELETE trigger on crm_deals and crm_clients writes one
-- audit_logs row per deleted record, in the same transaction as the delete:
--   action      deal_deleted / contact_deleted
--   target_id   the deleted row's id
--   actor_id    the signed-in user (auth.uid())
--   metadata    { actor_email, deleted_at, row: <the whole deleted row as JSON>,
--                 children: { emails, docs, forms, meetings, commissions }  (deals) }
-- The full row snapshot means a deleted deal/contact can be re-created exactly.
-- (The child rows' contents are not copied — only their counts, so the log shows
-- how much went with the deal.)
--
-- WHO CAN READ IT. audit_logs already has the owner-and-self read policy
-- (audit-logs-owner-lock.sql): the owner sees every row, anyone else sees only
-- rows they are the actor of. No policy change needed.
--
-- NO-USER DELETES. A delete with no signed-in user (service-role job, a script,
-- the SQL editor) has auth.uid() = NULL, but audit_logs.actor_id is NOT NULL and
-- references crm_profiles. Those rows are attributed to the owner profile with
-- metadata.no_signed_in_user = true so they are still recorded and recognisable.
--
-- SAFETY. SECURITY DEFINER (audit_logs has no INSERT policy for app roles) with a
-- pinned search_path. The body is wrapped in an exception handler: if logging ever
-- fails the delete STILL goes through with a WARNING — an audit trail must not be
-- able to block a legitimate delete. Idempotent; safe to re-run.

create or replace function public.crm_log_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind   text := tg_argv[0];                 -- 'deal' | 'contact'
  v_uid    uuid := auth.uid();
  v_actor  uuid;
  v_email  text;
  v_kids   jsonb := null;
  v_row    jsonb := to_jsonb(old);
begin
  begin
    v_actor := v_uid;
    if v_actor is null then
      select id into v_actor from crm_profiles where role = 'super_admin' order by created_at limit 1;
    end if;
    if v_actor is null then
      return old;                              -- nothing valid to attribute it to
    end if;
    select email into v_email from crm_profiles where id = v_actor;

    if v_kind = 'deal' then
      v_kids := jsonb_build_object(
        'emails',      (select count(*) from crm_deal_emails    where deal_id = old.id),
        'docs',        (select count(*) from crm_deal_docs      where deal_id = old.id)
                     + (select count(*) from crm_docs           where deal_id = old.id),
        'forms',       (select count(*) from crm_deal_forms     where deal_id = old.id),
        'meetings',    (select count(*) from crm_deal_meetings  where deal_id = old.id),
        'commissions', (select count(*) from crm_commissions    where deal_id = old.id)
      );
    end if;

    insert into audit_logs (actor_id, action, target_type, target_id, metadata, org_id)
    values (
      v_actor,
      v_kind || '_deleted',
      v_kind,
      old.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'actor_email', v_email,
        'deleted_at',  now(),
        'no_signed_in_user', case when v_uid is null then true end,
        'row',         v_row,
        'children',    v_kids
      )),
      nullif(v_row->>'org_id', '')::uuid
    );
  exception when others then
    raise warning 'crm_log_delete failed for % %: %', v_kind, old.id, sqlerrm;
  end;
  return old;
end;
$$;

revoke all on function public.crm_log_delete() from public, anon, authenticated;

drop trigger if exists zz_crm_deals_log_delete on public.crm_deals;
create trigger zz_crm_deals_log_delete
  before delete on public.crm_deals
  for each row execute function public.crm_log_delete('deal');

drop trigger if exists zz_crm_clients_log_delete on public.crm_clients;
create trigger zz_crm_clients_log_delete
  before delete on public.crm_clients
  for each row execute function public.crm_log_delete('contact');
