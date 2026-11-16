-- Secure uploads: record that each stored file passed the in-house safety scan (src/lib/file-scan.ts).
-- Additive and nullable: files uploaded before the scan existed simply have no badge. Idempotent; safe to re-run.
alter table public.crm_secure_files add column if not exists scan_status  text;          -- 'clean' (anything flagged is refused and never stored)
alter table public.crm_secure_files add column if not exists scan_version int;
alter table public.crm_secure_files add column if not exists scanned_at   timestamptz;
