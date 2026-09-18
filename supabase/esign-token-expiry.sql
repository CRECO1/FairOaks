-- ============================================================================
-- Expiring signing links  (audit H4)
--
-- WHY: crm_envelope_signers.access_token is the only thing gating the public
-- /sign/<token> page. The token itself is strong (24 random bytes), but it had
-- no lifetime — a link forwarded, leaked, or left sitting in an old inbox
-- granted access to a legal document forever.
--
-- 30 days from creation, which comfortably exceeds the e-sign reminder cadence
-- (cron/esign-reminders runs daily). Re-sending an invitation does not mint a
-- new token, so the CRM's "resend" path keeps working within the window; past
-- that, the sender issues a new envelope.
--
-- BACKFILL NOTE: existing rows are given a fresh 30-day window measured from
-- *now*, not from created_at, so that nothing currently out for signature
-- expires the moment this ships.
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.crm_envelope_signers
  add column if not exists expires_at timestamptz;

-- New rows: 30 days from insert.
alter table public.crm_envelope_signers
  alter column expires_at set default (now() + interval '30 days');

-- Existing rows: fresh window from now, so in-flight envelopes are unaffected.
update public.crm_envelope_signers
   set expires_at = now() + interval '30 days'
 where expires_at is null;

commit;

-- VERIFY
--   select status, count(*), min(expires_at), max(expires_at)
--     from crm_envelope_signers group by status order by 2 desc;
--
-- ROLLBACK
--   alter table public.crm_envelope_signers alter column expires_at drop default;
--   alter table public.crm_envelope_signers drop column expires_at;
