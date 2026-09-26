-- GA4 connection by user OAuth, so no service-account key is needed.
--
-- WHY. The GA4 Data API integration has been dormant waiting on
-- GA4_SERVICE_ACCOUNT_KEY, and that key cannot be created: the Google
-- organisation policy iam.disableServiceAccountKeyCreation blocks it, and
-- lifting it needs an org admin at a desktop console. A user OAuth refresh
-- token reaches the same API with the same read-only data and needs only one
-- consent tap from the account that already owns the GA property.
--
-- The refresh token is stored encrypted with the same AES-256-GCM helper that
-- protects the Gmail tokens (src/lib/token-crypto.ts).
--
-- `pending_nonce` holds the one-time value for a consent round-trip. The
-- authorization link is opened on a phone that has never seen this app, so the
-- Gmail flow's HttpOnly-cookie CSRF binding is not available; the nonce lives
-- here instead, is single-use, and expires.

create table if not exists public.ga4_oauth (
  id                  text primary key default 'default',
  refresh_token_enc   text,
  account_email       text,
  property_id         text,
  connected_at        timestamptz,
  last_error          text,
  pending_nonce       text,
  pending_expires_at  timestamptz,
  updated_at          timestamptz not null default now()
);

insert into public.ga4_oauth (id) values ('default') on conflict (id) do nothing;

-- Service role only. RLS on with no policy denies anon and authenticated every
-- operation regardless of grants; this table holds a live Google credential and
-- nothing in the browser has any business reading it.
alter table public.ga4_oauth enable row level security;
revoke all on table public.ga4_oauth from anon, authenticated;
grant all on table public.ga4_oauth to service_role;
