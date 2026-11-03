-- My Drive templates: a document can be a template (a reusable starting point the whole team can copy).
--
-- Adds one column, crm_drive_docs.is_template. Template documents live outside folders, are team-visible, are left out of the
-- normal file lists / Recent / search, and are listed under "Templates". Using a template COPIES it into the folder you are in
-- (the copy is an ordinary document); "Save as template" copies a document the other way. Nothing else changes.
--
-- Rollback (templates would become ordinary documents in All files):
--   alter table public.crm_drive_docs drop column if exists is_template;
-- Idempotent; safe to re-run.

alter table public.crm_drive_docs add column if not exists is_template boolean not null default false;
create index if not exists crm_drive_docs_template_idx on public.crm_drive_docs (business_unit) where is_template and trashed_at is null;
