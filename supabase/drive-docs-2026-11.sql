-- Transaction Docs "Drive": nested folders + live (multi-cursor) documents.
--
-- New tables (all writes go through the CRM API with the service role; RLS below only lets a signed-in user READ what they may see):
--   crm_drive_folders  nested folders (parent_id), Team or Private, optional link to a deal
--   crm_drive_docs     live documents; `ystate` is the merged Yjs state (base64), `content_text` is plain text for search
-- (There is an older, empty, deal-only table called crm_docs — it is NOT touched.)
--
-- Who can see an item (crm_drive_can):
--   * super_admin: everything.
--   * everyone else must be in the item's workspace (business_unit);
--   * Private items: the owner (created_by) and anyone in shared_with;
--   * Items linked to a deal: only people on that deal (owner / assigned agent), plus admins for non-restricted deals —
--     the same rule as deals themselves (agent-deal-visibility-rule). A linked deal that no longer exists hides the item
--     from everyone but its owner and the super admin (it never falls back to "team").
--   Visibility is stored on every item (copied from its folder when created / moved, cascaded when a folder is shared), so the
--   check is a single row test with no walk up the tree.
--
-- Live sync: documents sync over Supabase Realtime *private* broadcast channels named  drive-doc:<doc id>. The policies on
-- realtime.messages below let a user join / send on a channel only when crm_drive_doc_access() says they can open that doc.
--
-- Rollback (drops everything this file creates; safe — nothing else references it):
--   drop policy if exists drive_docs_rt_receive on realtime.messages;
--   drop policy if exists drive_docs_rt_send on realtime.messages;
--   drop function if exists public.crm_drive_topic_ok(text);
--   drop function if exists public.crm_drive_doc_access(uuid);
--   drop function if exists public.crm_drive_row_ok(text, text, uuid[], uuid, uuid);
--   drop table if exists public.crm_drive_docs;
--   drop table if exists public.crm_drive_folders;
--   drop function if exists public.crm_drive_can(uuid, text, text, uuid[], uuid, uuid);
-- Idempotent; safe to re-run.

-- ── tables ────────────────────────────────────────────────────────────────────

create table if not exists public.crm_drive_folders (
  id            uuid primary key default gen_random_uuid(),
  business_unit text not null,
  parent_id     uuid references public.crm_drive_folders(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 200),
  created_by    uuid references auth.users(id) on delete set null,
  visibility    text not null default 'team' check (visibility in ('team', 'private')),
  shared_with   uuid[] not null default '{}',
  deal_id       uuid,
  trashed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.crm_drive_docs (
  id            uuid primary key default gen_random_uuid(),
  business_unit text not null,
  folder_id     uuid references public.crm_drive_folders(id) on delete cascade,
  title         text not null default 'Untitled document' check (char_length(btrim(title)) between 1 and 300),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  visibility    text not null default 'team' check (visibility in ('team', 'private')),
  shared_with   uuid[] not null default '{}',
  deal_id       uuid,
  ystate        text,                          -- base64 of Y.encodeStateAsUpdate(doc), merged server-side
  version       integer not null default 0,    -- bumped on every state save (optimistic concurrency)
  content_text  text not null default '',      -- plain text, for search and previews
  trashed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_drive_folders_parent_idx on public.crm_drive_folders (business_unit, parent_id) where trashed_at is null;
create index if not exists crm_drive_folders_trash_idx  on public.crm_drive_folders (business_unit) where trashed_at is not null;
create index if not exists crm_drive_docs_folder_idx    on public.crm_drive_docs (business_unit, folder_id) where trashed_at is null;
create index if not exists crm_drive_docs_recent_idx    on public.crm_drive_docs (business_unit, updated_at desc) where trashed_at is null;
create index if not exists crm_drive_docs_trash_idx     on public.crm_drive_docs (business_unit) where trashed_at is not null;

-- ── access rule (single source of truth; the API calls it through rpc, RLS and Realtime call it too) ──

create or replace function public.crm_drive_can(
  p_uid uuid, p_bu text, p_vis text, p_shared uuid[], p_owner uuid, p_deal uuid
) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  pr record;
  d  record;
begin
  select role, business_unit into pr from public.crm_profiles where id = p_uid;
  if not found then return false; end if;
  if pr.role = 'super_admin' then return true; end if;
  if pr.business_unit is distinct from p_bu then return false; end if;
  if p_vis = 'private' and not (p_owner = p_uid or p_uid = any (coalesce(p_shared, '{}'::uuid[]))) then return false; end if;
  if p_deal is not null then
    select agent_id, assigned_agent_ids, is_restricted into d from public.crm_deals where id = p_deal;
    if not found then return p_owner = p_uid; end if;
    if coalesce(d.is_restricted, false)
       and not (d.agent_id = p_uid or p_uid = any (coalesce(d.assigned_agent_ids, '{}'::uuid[]))) then
      return false;
    end if;
    if pr.role = 'admin' then return true; end if;
    return d.agent_id = p_uid or p_uid = any (coalesce(d.assigned_agent_ids, '{}'::uuid[]));
  end if;
  return true;
end
$$;
revoke all on function public.crm_drive_can(uuid, text, text, uuid[], uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_drive_can(uuid, text, text, uuid[], uuid, uuid) to service_role;

-- The row policies run as the signed-in user, so they call this wrapper: it can only ever answer for auth.uid() (the 6-argument
-- function above stays service-role only, so nobody can use it to probe what someone else can see).
create or replace function public.crm_drive_row_ok(p_bu text, p_vis text, p_shared uuid[], p_owner uuid, p_deal uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_drive_can(auth.uid(), p_bu, p_vis, p_shared, p_owner, p_deal);
$$;
revoke all on function public.crm_drive_row_ok(text, text, uuid[], uuid, uuid) from public, anon;
grant execute on function public.crm_drive_row_ok(text, text, uuid[], uuid, uuid) to authenticated, service_role;

-- "May the signed-in user open this document?" — used by Realtime and by the read policies. Takes no user argument on purpose,
-- so nobody can use it to probe what someone else can see.
create or replace function public.crm_drive_doc_access(p_doc uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.crm_drive_docs d
    where d.id = p_doc and d.trashed_at is null
      and public.crm_drive_can(auth.uid(), d.business_unit, d.visibility, d.shared_with, d.created_by, d.deal_id)
  );
$$;
revoke all on function public.crm_drive_doc_access(uuid) from public, anon;
grant execute on function public.crm_drive_doc_access(uuid) to authenticated, service_role;

-- Realtime topic guard: 'drive-doc:<uuid>' only; a malformed topic is simply denied (never an error).
create or replace function public.crm_drive_topic_ok(p_topic text) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  if p_topic is null or p_topic !~ '^drive-doc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return public.crm_drive_doc_access(substr(p_topic, 11)::uuid);
end
$$;
revoke all on function public.crm_drive_topic_ok(text) from public, anon;
grant execute on function public.crm_drive_topic_ok(text) to authenticated, service_role;

-- ── row level security: read-only for signed-in users; writes only via the service role ──

alter table public.crm_drive_folders enable row level security;
alter table public.crm_drive_docs    enable row level security;

drop policy if exists drive_folders_read on public.crm_drive_folders;
create policy drive_folders_read on public.crm_drive_folders for select to authenticated
  using (public.crm_drive_row_ok(business_unit, visibility, shared_with, created_by, deal_id));

drop policy if exists drive_docs_read on public.crm_drive_docs;
create policy drive_docs_read on public.crm_drive_docs for select to authenticated
  using (public.crm_drive_row_ok(business_unit, visibility, shared_with, created_by, deal_id));

-- ── Realtime: only people who can open a doc may join or speak on its private channel ──

drop policy if exists drive_docs_rt_receive on realtime.messages;
create policy drive_docs_rt_receive on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.crm_drive_topic_ok((select realtime.topic())));

drop policy if exists drive_docs_rt_send on realtime.messages;
create policy drive_docs_rt_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.crm_drive_topic_ok((select realtime.topic())));
