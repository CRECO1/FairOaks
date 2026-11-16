-- Full secure folders (My Drive): a secure folder no longer has to start as a document request to a contact.
--   kind = 'request'  the existing flow (a checklist sent to a contact / deal's contact)
--   kind = 'folder'   a folder an agent creates in My Drive: a name, their own files, optionally shared by link + password
-- A PASSWORD (pass_hash, scrypt) can gate the link: without it the page shows only a password box. With a password the folder
-- may also let the guest VIEW its files (guest_view); without one the link stays upload-only, as before.
-- Additive and nullable; existing rows keep working unchanged. Idempotent; safe to re-run.

alter table public.crm_secure_requests alter column client_id drop not null;
alter table public.crm_secure_requests add column if not exists kind            text not null default 'request';
alter table public.crm_secure_requests add column if not exists name            text;
alter table public.crm_secure_requests add column if not exists pass_hash       text;            -- never returned by any API
alter table public.crm_secure_requests add column if not exists guest_view      boolean not null default false;
alter table public.crm_secure_requests add column if not exists failed_attempts int not null default 0;
alter table public.crm_secure_requests add column if not exists locked_until    timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'crm_secure_requests_kind_check') then
    alter table public.crm_secure_requests add constraint crm_secure_requests_kind_check check (kind in ('request','folder'));
  end if;
  -- a request always belongs to a contact; only a folder may stand alone
  if not exists (select 1 from pg_constraint where conname = 'crm_secure_requests_owner_check') then
    alter table public.crm_secure_requests add constraint crm_secure_requests_owner_check check (kind = 'folder' or client_id is not null);
  end if;
  -- guests can only ever view a folder that has a password
  if not exists (select 1 from pg_constraint where conname = 'crm_secure_requests_view_needs_password') then
    alter table public.crm_secure_requests add constraint crm_secure_requests_view_needs_password check (not guest_view or pass_hash is not null);
  end if;
end $$;

-- Who added a file: null = the guest/tenant through the link; set = an agent from inside the CRM.
alter table public.crm_secure_files add column if not exists uploaded_by uuid references public.crm_profiles(id) on delete set null;
