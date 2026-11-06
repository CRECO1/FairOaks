-- Nightly CRM backup status (owner-only). Written by the Mac's backup job with the service role,
-- read by /api/crm/backup-runs (super_admin only). Server-only: RLS on, no policies, no browser grants.
begin;
create table if not exists public.crm_backup_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean not null default false,
  tables_count integer,
  contacts     integer,
  new_files    integer,
  new_bytes    bigint,
  total_files  integer,
  total_bytes  bigint,
  failed       jsonb not null default '[]'::jsonb,
  host         text
);
create index if not exists crm_backup_runs_started_idx on public.crm_backup_runs (started_at desc);
alter table public.crm_backup_runs enable row level security;
revoke all on public.crm_backup_runs from anon, authenticated;
revoke all on sequence public.crm_backup_runs_id_seq from anon, authenticated;
commit;
