-- Email snippets: saved replies an agent can drop into any email (Compose, a deal's email tab, a reply).
--
-- Personal by default; an agent may mark one "shared" so everyone in the same workspace (business_unit) can use it.
-- Server-only table: the app reads and writes it through /api/crm/email-snippets with the service role, so no
-- browser role is granted anything (RLS on, no policies, privileges revoked).
-- Removing an agent removes their snippets. Idempotent; safe to re-run.

create table if not exists public.crm_email_snippets (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.crm_profiles(id) on delete cascade,
  business_unit text not null default 'commercial',
  name          text not null,
  subject       text not null default '',
  body_html     text not null default '',
  shared        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists crm_email_snippets_user_idx   on public.crm_email_snippets (user_id, name);
create index if not exists crm_email_snippets_shared_idx on public.crm_email_snippets (business_unit) where shared;

alter table public.crm_email_snippets enable row level security;
revoke all on public.crm_email_snippets from anon, authenticated;

-- (added before first use) the template's subject line
alter table public.crm_email_snippets add column if not exists subject text not null default '';
