-- My Drive live documents: comments (with @mentions, replies, resolve) and version history.
--
--   crm_drive_comments  one row per comment or reply on a live document. A top-level comment's id doubles as the id of the
--                       highlight mark stored in the document itself, so it stays attached to its words as people edit.
--   crm_drive_versions  full snapshots (Yjs state) of a document: automatic ones (at most one per 10 minutes of editing),
--                       named ones ("Save a version"), and a safety copy taken just before any restore.
--
-- Both are readable by anyone who can open the document (crm_drive_doc_access, from drive-docs-2026-11.sql) and writable only
-- through the CRM API (service role), which re-checks access and, for @mentions, that each person mentioned can open the doc.
-- Deleting a document deletes its comments and versions.
--
-- Rollback (nothing else references them):
--   drop table if exists public.crm_drive_comments;
--   drop table if exists public.crm_drive_versions;
-- Idempotent; safe to re-run.

create table if not exists public.crm_drive_comments (
  id          uuid primary key default gen_random_uuid(),
  doc_id      uuid not null references public.crm_drive_docs(id) on delete cascade,
  parent_id   uuid references public.crm_drive_comments(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  body        text not null check (char_length(btrim(body)) between 1 and 4000),
  mentions    uuid[] not null default '{}',
  anchor_text text,                       -- the words the comment was made on (null = a general comment)
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists crm_drive_comments_doc_idx on public.crm_drive_comments (doc_id, created_at);

create table if not exists public.crm_drive_versions (
  id           uuid primary key default gen_random_uuid(),
  doc_id       uuid not null references public.crm_drive_docs(id) on delete cascade,
  ystate       text not null,
  content_text text not null default '',
  size         integer,
  label        text,
  kind         text not null default 'auto' check (kind in ('auto', 'manual', 'restore')),
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists crm_drive_versions_doc_idx on public.crm_drive_versions (doc_id, created_at desc);

alter table public.crm_drive_comments enable row level security;
alter table public.crm_drive_versions enable row level security;

drop policy if exists drive_comments_read on public.crm_drive_comments;
create policy drive_comments_read on public.crm_drive_comments for select to authenticated
  using (public.crm_drive_doc_access(doc_id));

drop policy if exists drive_versions_read on public.crm_drive_versions;
create policy drive_versions_read on public.crm_drive_versions for select to authenticated
  using (public.crm_drive_doc_access(doc_id));
