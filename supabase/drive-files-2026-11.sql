-- My Drive: uploaded files (PDF, Word, Excel, images…) that live in folders next to the live documents.
--
-- Adds crm_drive_files (same visibility model and the same crm_drive_row_ok() read policy as crm_drive_folders / crm_drive_docs,
-- see drive-docs-2026-11.sql) and a private storage bucket `drive-files`. Files are uploaded straight from the browser with a
-- signed upload URL; every read of a file goes through the CRM API, which checks the row is visible first and then signs a
-- one-hour link — the bucket itself has no public policy.
--
-- Rollback (nothing else references it):
--   drop table if exists public.crm_drive_files;
--   delete from storage.buckets where id = 'drive-files';   -- only after emptying it
-- Idempotent; safe to re-run.

create table if not exists public.crm_drive_files (
  id            uuid primary key default gen_random_uuid(),
  business_unit text not null,
  folder_id     uuid references public.crm_drive_folders(id) on delete cascade,
  name          text not null check (char_length(btrim(name)) between 1 and 300),
  storage_path  text not null unique,
  size          bigint,
  mime          text,
  created_by    uuid references auth.users(id) on delete set null,
  visibility    text not null default 'team' check (visibility in ('team', 'private')),
  shared_with   uuid[] not null default '{}',
  deal_id       uuid,
  trashed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_drive_files_folder_idx on public.crm_drive_files (business_unit, folder_id) where trashed_at is null;
create index if not exists crm_drive_files_trash_idx  on public.crm_drive_files (business_unit) where trashed_at is not null;

alter table public.crm_drive_files enable row level security;
drop policy if exists drive_files_read on public.crm_drive_files;
create policy drive_files_read on public.crm_drive_files for select to authenticated
  using (public.crm_drive_row_ok(business_unit, visibility, shared_with, created_by, deal_id));

-- Private bucket, 50 MB per file, office documents / PDFs / spreadsheets / images / text only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('drive-files', 'drive-files', false, 52428800, array[
  'application/pdf',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'text/plain'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
