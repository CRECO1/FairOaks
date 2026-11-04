-- My Drive spreadsheets ("Sheets"): a document can now be a live spreadsheet instead of a text document.
-- Additive and safe to run before the code is deployed (old code ignores the column). Rollback: alter table public.crm_drive_docs drop column kind;
alter table public.crm_drive_docs
  add column if not exists kind text not null default 'doc';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_drive_docs_kind_check') then
    alter table public.crm_drive_docs add constraint crm_drive_docs_kind_check check (kind in ('doc','sheet'));
  end if;
end $$;
