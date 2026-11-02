-- Contact files: documents and photos uploaded straight onto a contact's card (a lease copy, an ID, a notice).
--
-- Files live in the existing private `deal-docs` storage bucket under `client-<contact id>/`, so the bucket's
-- type and size limits apply unchanged. Server-only table: read and written through /api/crm/client-docs with the
-- service role, so no browser role is granted anything (RLS on, no policies, privileges revoked).
-- Deleting a contact removes its file rows. Idempotent; safe to re-run.

create table if not exists public.crm_client_docs (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.crm_clients(id) on delete cascade,
  name          text not null,
  storage_path  text not null,
  file_size     bigint,
  file_type     text,
  uploaded_by   uuid references public.crm_profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists crm_client_docs_client_idx on public.crm_client_docs (client_id, created_at desc);

alter table public.crm_client_docs enable row level security;
revoke all on public.crm_client_docs from anon, authenticated;
