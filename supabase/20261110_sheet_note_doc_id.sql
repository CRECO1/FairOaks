-- A team note typed in a live-feed sheet is mirrored onto the contact's card (see src/lib/sheet-note-mirror.ts).
-- Until now the mirrored note was found again by its text ("Team note · <sheet title> — …"), so two sheets with similar titles could
-- overwrite each other's notes and renaming a sheet orphaned them. sheet_doc_id ties ONE card note to ONE sheet, by the sheet's id.
-- Additive and nullable: existing rows keep working and are adopted by the sheet the next time that sheet's note changes.
alter table crm_client_activities add column if not exists sheet_doc_id uuid;
create unique index if not exists crm_client_activities_sheet_note_uniq
  on crm_client_activities (client_id, sheet_doc_id) where sheet_doc_id is not null;
