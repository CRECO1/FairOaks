-- My Drive: transaction forms (TREC, TXR, leases, LOIs … the whole form library) filed in Drive folders.
--
-- A form in Drive is an ordinary saved form (crm_form_submissions) plus one row here that says "this submission lives in that folder".
-- The saved form itself — its fields, PDF, edit history, e-sign envelopes, live co-filling — is untouched and still works everywhere else.
--   * Forms may only sit in TEAM folders (not Private ones, not deal-linked folders): who can open a saved form is decided by the forms
--     rules (workspace-wide for a form with no deal / property), and a Private folder would promise more than that. The API enforces it.
--   * Removing a form from Drive (or deleting its folder) removes only this link row — it never deletes the saved form or anything signed.
--   * If the saved form is deleted elsewhere, the link goes with it (on delete cascade).
--
-- Read access: anyone in the workspace (the same team-level rule the other Drive tables use); writes only through the CRM API.
--
-- Rollback (nothing else references it):  drop table if exists public.crm_drive_forms;
-- Idempotent; safe to re-run.

create table if not exists public.crm_drive_forms (
  id            uuid primary key default gen_random_uuid(),
  business_unit text not null,
  folder_id     uuid references public.crm_drive_folders(id) on delete cascade,
  submission_id uuid not null unique references public.crm_form_submissions(id) on delete cascade,
  created_by    uuid references auth.users(id) on delete set null,
  trashed_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_drive_forms_folder_idx on public.crm_drive_forms (business_unit, folder_id) where trashed_at is null;
create index if not exists crm_drive_forms_trash_idx  on public.crm_drive_forms (business_unit) where trashed_at is not null;

alter table public.crm_drive_forms enable row level security;
drop policy if exists drive_forms_read on public.crm_drive_forms;
create policy drive_forms_read on public.crm_drive_forms for select to authenticated
  using (public.crm_drive_row_ok(business_unit, 'team', '{}'::uuid[], created_by, null));
