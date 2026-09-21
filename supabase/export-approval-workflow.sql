-- Export-approval workflow.
--
-- Exporting the contact database is the one CRM action that turns the book
-- into a portable file someone can walk out with. Anyone who is not the
-- account owner now has to ask, and the owner has to say yes, every time.
-- There is no standing approval: each export consumes its own permission.
--
-- The owner (super_admin) is the approver, so he exports directly and never
-- appears in this table.

create table if not exists crm_export_requests (
  id                  uuid primary key default gen_random_uuid(),

  -- Who asked. Captured from the server session, never from the client.
  requester_id        uuid        not null,
  requester_name      text        not null,
  requester_email     text,

  -- What they asked for. scope_key is the canonical fingerprint the export
  -- route re-derives at download time: an approval for "these 12 contacts"
  -- must not redeem against "all 4,000".
  business_unit       text        not null,
  scope_key           text        not null,
  scope_label         text        not null,
  row_count           integer     not null default 0,

  status              text        not null default 'pending'
                      check (status in ('pending','approved','denied','consumed','expired')),

  -- Approve/deny links carry a random token; only its SHA-256 is stored, so
  -- a leaked database row cannot be used to approve anything.
  token_hash          text        not null unique,
  token_expires_at    timestamptz not null,
  token_used_at       timestamptz,

  -- An approval opens a short window and closes after one download.
  approved_at         timestamptz,
  approved_by         uuid,
  approval_expires_at timestamptz,

  denied_at           timestamptz,
  denied_by           uuid,

  consumed_at         timestamptz,

  requested_ip        text,
  created_at          timestamptz not null default now()
);

create index if not exists crm_export_requests_requester_idx
  on crm_export_requests (requester_id, status, created_at desc);

create index if not exists crm_export_requests_pending_idx
  on crm_export_requests (status, created_at desc)
  where status = 'pending';

-- RLS on with no policies: every path in and out of this table goes through an
-- API route that checks the caller's role with the service key. Nothing reaches
-- it with an anon or authenticated JWT, including the CRM's own browser client.
alter table crm_export_requests enable row level security;

comment on table crm_export_requests is
  'Pending/approved/denied contact-export requests. Owner approves each one; approvals are single-use and time-boxed.';
comment on column crm_export_requests.scope_key is
  'Canonical fingerprint of the requested scope, re-derived at download and compared, so an approval cannot be redeemed for a wider export than was approved.';
comment on column crm_export_requests.token_hash is
  'SHA-256 of the approve/deny link token. The raw token exists only in the email.';
