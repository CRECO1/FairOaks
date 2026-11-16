-- Secure document requests: a broker asks a tenant/buyer for sensitive paperwork (rental application, ID, pay stubs,
-- bank statements, tax returns) and the person uploads it through a private, expiring link — no login, no email attachments.
--
-- Storage: a NEW private bucket `secure-intake`, separate from deal-docs, so these files never show up in the contact's
-- ordinary Files, My Drive, Copilot or any listing. Objects live under `req-<request id>/`.
-- Tables are server-only: read and written through /api/crm/secure-requests (agents) and /api/secure-upload/[token]
-- (the tenant) with the service role; RLS on, no policies, no browser privileges.
-- Idempotent; safe to re-run.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('secure-intake', 'secure-intake', false, 26214400,
  array['application/pdf','image/jpeg','image/png','image/webp',
        'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/csv'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.crm_secure_requests (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.crm_clients(id) on delete cascade,
  deal_id         uuid references public.crm_deals(id) on delete set null,
  business_unit   text not null default 'commercial',
  created_by      uuid references public.crm_profiles(id) on delete set null,
  shared_with     uuid[] not null default '{}',          -- agents the creator added; the contact's owner + broker always see it
  recipient_name  text,
  recipient_email text,
  note            text,
  items           jsonb not null default '[]'::jsonb,    -- [{ key, label }] the checklist the tenant sees
  token           text not null unique,
  status          text not null default 'open' check (status in ('open','revoked')),
  expires_at      timestamptz not null,
  purge_after     timestamptz not null,                  -- files are deleted after this unless keep_files
  keep_files      boolean not null default false,
  purged_at       timestamptz,
  sent_at         timestamptz,
  reminded_at     timestamptz,
  reminder_count  int not null default 0,
  first_viewed_at timestamptz,
  view_count      int not null default 0,
  last_upload_at  timestamptz,
  submitted_at    timestamptz,                           -- the tenant pressed "I'm done"
  notified_at     timestamptz,                           -- the agent was last told about uploads
  created_at      timestamptz not null default now()
);
create index if not exists crm_secure_requests_client_idx on public.crm_secure_requests (client_id, created_at desc);
create index if not exists crm_secure_requests_purge_idx on public.crm_secure_requests (purge_after) where purged_at is null;

create table if not exists public.crm_secure_files (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.crm_secure_requests(id) on delete cascade,
  item_key      text,
  name          text not null,
  storage_path  text not null unique,
  file_size     bigint,
  file_type     text,
  created_at    timestamptz not null default now()
);
create index if not exists crm_secure_files_request_idx on public.crm_secure_files (request_id, created_at);

-- Who did what, and when. Kept after files are deleted or purged (that is the point of a trail).
create table if not exists public.crm_secure_log (
  id          bigint generated always as identity primary key,
  request_id  uuid not null references public.crm_secure_requests(id) on delete cascade,
  actor_id    uuid,                                      -- CRM user; null = the tenant or the system
  actor_label text not null,                             -- 'tenant', 'system', or the agent's name
  action      text not null,                             -- created, sent, viewed, uploaded, removed, submitted, downloaded, deleted, revoked, extended, kept, shared, purged
  detail      text,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists crm_secure_log_request_idx on public.crm_secure_log (request_id, created_at desc);

alter table public.crm_secure_requests enable row level security;
alter table public.crm_secure_files    enable row level security;
alter table public.crm_secure_log      enable row level security;
revoke all on public.crm_secure_requests from anon, authenticated;
revoke all on public.crm_secure_files    from anon, authenticated;
revoke all on public.crm_secure_log      from anon, authenticated;
