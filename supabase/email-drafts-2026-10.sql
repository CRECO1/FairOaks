-- Email drafts: each agent's own unsent emails, synced between desktop and phone.
--
-- One row per (agent, draft_key). The key says what the draft is for — a deal's email tab, a contact card,
-- a reply in a thread, or the global Compose window — so reopening that place restores it.
-- Personal: an agent only ever sees and changes their own drafts (not visible to other agents or admins).
-- Server-only table: the app reads and writes it through /api/crm/email-drafts with the service role, so no
-- browser role is granted anything (RLS on, no policies, privileges revoked).
--
-- Cascades: removing an agent removes their drafts with them. Idempotent; safe to re-run.

create table if not exists public.crm_email_drafts (
  user_id    uuid not null references public.crm_profiles(id) on delete cascade,
  draft_key  text not null,
  subject    text not null default '',
  to_emails  text not null default '',
  more_to    text not null default '',
  cc_emails  text not null default '',
  bcc_emails text not null default '',
  body_html  text not null default '',
  context    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, draft_key)
);

create index if not exists crm_email_drafts_user_updated_idx on public.crm_email_drafts (user_id, updated_at desc);

alter table public.crm_email_drafts enable row level security;
revoke all on public.crm_email_drafts from anon, authenticated;
