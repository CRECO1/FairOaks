-- My Drive: (1) live links from a document to deal cards / contact cards, (2) a full activity log per document.
--
-- crm_drive_doc_links    a Drive document shown on a deal's or a contact's card AS ITSELF (not a PDF copy): opening it from the card opens the
--                        live document, so the card is always current. One row per (doc, deal) or (doc, contact).
-- crm_drive_doc_events   every change to a document: created, edited (one row per editing session, coalesced), renamed, moved, shared,
--                        linked / unlinked, trashed, restored, version saved / restored, commented, deleted. No FK to the document on purpose:
--                        the trail outlives a permanently deleted document.
--
-- Both tables are service-role only (RLS on, no policies): the API checks access first, then reads / writes.
--
-- Who can open a LINKED document (crm_drive_linked_ok) — the same rule as the card it is on:
--   * super_admin: everything.   * a linked DEAL: admins see it unless the deal is Restricted and not theirs; an agent only if on the deal
--     (owner or assigned) in the same workspace — exactly assertOwnsResource / deals RLS.
--   * a linked CONTACT: anyone in the contact's workspace (that is who can open the contact card), admins anywhere; a held lead (lead_hold)
--     only for its owner and the super admin.
-- That is added to crm_drive_doc_access (used by Realtime, comments and versions) and as a second read policy on crm_drive_docs, so a person
-- who reaches the document from a card can open it, edit it live with others, comment and see its versions.
--
-- Rollback:
--   drop policy if exists drive_docs_read_linked on public.crm_drive_docs;
--   (re-run drive-docs-2026-11.sql to restore crm_drive_doc_access to its original body)
--   drop function if exists public.crm_drive_doc_linked_ok(uuid);
--   drop function if exists public.crm_drive_linked_ok(uuid, uuid);
--   drop table if exists public.crm_drive_doc_events;
--   drop table if exists public.crm_drive_doc_links;
-- Idempotent; safe to re-run.

create table if not exists public.crm_drive_doc_links (
  id            uuid primary key default gen_random_uuid(),
  doc_id        uuid not null references public.crm_drive_docs(id) on delete cascade,
  deal_id       uuid references public.crm_deals(id) on delete cascade,
  client_id     uuid references public.crm_clients(id) on delete cascade,
  business_unit text not null,
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint crm_drive_doc_links_one_target check (num_nonnulls(deal_id, client_id) = 1)
);
create unique index if not exists crm_drive_doc_links_deal_uq   on public.crm_drive_doc_links (doc_id, deal_id)   where deal_id is not null;
create unique index if not exists crm_drive_doc_links_client_uq on public.crm_drive_doc_links (doc_id, client_id) where client_id is not null;
create index if not exists crm_drive_doc_links_deal_idx   on public.crm_drive_doc_links (deal_id)   where deal_id is not null;
create index if not exists crm_drive_doc_links_client_idx on public.crm_drive_doc_links (client_id) where client_id is not null;
alter table public.crm_drive_doc_links enable row level security;

create table if not exists public.crm_drive_doc_events (
  id            uuid primary key default gen_random_uuid(),
  doc_id        uuid not null,
  business_unit text not null,
  actor_id      uuid references auth.users(id) on delete set null,
  kind          text not null check (kind in ('created','edited','renamed','moved','shared','linked','unlinked','trashed','restored','version_saved','version_restored','commented','deleted','template_saved')),
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()    -- an editing session keeps one row: created_at = first save, updated_at = last save
);
create index if not exists crm_drive_doc_events_doc_idx on public.crm_drive_doc_events (doc_id, created_at desc);
alter table public.crm_drive_doc_events enable row level security;

-- "May this user open this document through a card it is linked to?"  (service role only; the wrapper below answers for auth.uid())
create or replace function public.crm_drive_linked_ok(p_uid uuid, p_doc uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  pr record; l record; d record; c record; on_deal boolean;
begin
  select role, business_unit into pr from public.crm_profiles where id = p_uid;
  if not found then return false; end if;
  for l in select deal_id, client_id from public.crm_drive_doc_links where doc_id = p_doc loop
    if l.deal_id is not null then
      select business_unit, agent_id, assigned_agent_ids, is_restricted into d from public.crm_deals where id = l.deal_id;
      if found then
        if pr.role = 'super_admin' then return true; end if;
        on_deal := d.agent_id = p_uid or p_uid = any (coalesce(d.assigned_agent_ids, '{}'::uuid[]));
        if coalesce(d.is_restricted, false) and not on_deal then continue; end if;
        if pr.role = 'admin' then return true; end if;
        if on_deal and d.business_unit is not distinct from pr.business_unit then return true; end if;
      end if;
    else
      select business_unit, agent_id, lead_hold into c from public.crm_clients where id = l.client_id;
      if found then
        if pr.role = 'super_admin' then return true; end if;
        if coalesce(c.lead_hold, false) and c.agent_id is distinct from p_uid then continue; end if;
        if pr.role = 'admin' or c.business_unit is not distinct from pr.business_unit then return true; end if;
      end if;
    end if;
  end loop;
  return false;
end
$$;
revoke all on function public.crm_drive_linked_ok(uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_drive_linked_ok(uuid, uuid) to service_role;

create or replace function public.crm_drive_doc_linked_ok(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_drive_linked_ok(auth.uid(), p_doc);
$$;
revoke all on function public.crm_drive_doc_linked_ok(uuid) from public, anon;
grant execute on function public.crm_drive_doc_linked_ok(uuid) to authenticated, service_role;

-- A linked document is also readable by people who reach it through its card.
drop policy if exists drive_docs_read_linked on public.crm_drive_docs;
create policy drive_docs_read_linked on public.crm_drive_docs for select to authenticated
  using (public.crm_drive_doc_linked_ok(id));

-- "May the signed-in user open this document?" now also counts a linked card they can see (Realtime, comments, versions all use it).
create or replace function public.crm_drive_doc_access(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_drive_docs d
    where d.id = p_doc and d.trashed_at is null
      and (public.crm_drive_can(auth.uid(), d.business_unit, d.visibility, d.shared_with, d.created_by, d.deal_id)
           or public.crm_drive_linked_ok(auth.uid(), d.id))
  );
$$;
revoke all on function public.crm_drive_doc_access(uuid) from public, anon;
grant execute on function public.crm_drive_doc_access(uuid) to authenticated, service_role;
