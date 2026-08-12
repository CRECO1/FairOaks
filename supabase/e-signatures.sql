-- ─────────────────────────────────────────────────────────────────────────────
-- E-signatures: multi-party sequential signing on top of crm_form_submissions.
-- Additive + idempotent. Applied live via the pooler (matches the house pattern
-- where no base-table DDL lives in the repo for the crm_form_* tables).
--
--   crm_envelopes         one per "send for signature" (the DocuSign envelope)
--   crm_envelope_signers  one row per party (client/landlord/agent), ordered
--   crm_envelope_events   append-only audit trail (ESIGN/UETA enforceability)
--
-- Access is service-role only (RLS on, no permissive policies) — every read/write
-- goes through an /api route: authed CRM routes (getCrmContext) or the public
-- token-gated /api/sign route. The browser never touches these tables directly.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Signature-field support on the existing template field model.
--    type gains 'signature' | 'initial' | 'date_signed' (alongside 'text' | 'check');
--    signer_role binds a field to a party (null = the broker fills it pre-send).
ALTER TABLE crm_form_fields ADD COLUMN IF NOT EXISTS signer_role text;   -- 'client' | 'landlord' | 'agent'

-- 2. Envelope — the unit that gets sent, tracked, and completed.
CREATE TABLE IF NOT EXISTS crm_envelopes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid REFERENCES crm_form_submissions(id) ON DELETE SET NULL,
  form_id       uuid REFERENCES crm_forms(id)            ON DELETE SET NULL,
  deal_id       uuid REFERENCES crm_deals(id)            ON DELETE SET NULL,
  listing_id    uuid REFERENCES crm_listings(id)         ON DELETE SET NULL,
  business_unit text NOT NULL DEFAULT 'commercial',
  title         text,
  message       text,                       -- optional note from the broker to signers
  status        text NOT NULL DEFAULT 'draft',  -- draft|sent|in_progress|completed|declined|voided
  source_path   text,                        -- filled PDF snapshot at send time (transaction-forms bucket)
  executed_path text,                        -- running/final signed PDF (+ certificate on completion)
  created_by    uuid,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  completed_at  timestamptz,
  voided_at     timestamptz,
  void_reason   text
);
CREATE INDEX IF NOT EXISTS idx_envelopes_deal    ON crm_envelopes(deal_id);
CREATE INDEX IF NOT EXISTS idx_envelopes_listing ON crm_envelopes(listing_id);
CREATE INDEX IF NOT EXISTS idx_envelopes_unit    ON crm_envelopes(business_unit);

-- 3. Signers — one ordered row per party. access_token gates the public /sign link.
CREATE TABLE IF NOT EXISTS crm_envelope_signers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id    uuid NOT NULL REFERENCES crm_envelopes(id) ON DELETE CASCADE,
  signer_role    text NOT NULL,                 -- 'client' | 'landlord' | 'agent'
  name           text NOT NULL,
  email          text NOT NULL,
  signing_order  int  NOT NULL DEFAULT 1,       -- 1-based; lower signs first
  status         text NOT NULL DEFAULT 'pending', -- pending|sent|viewed|signed|declined
  access_token   text NOT NULL UNIQUE,          -- opaque random token in the signing URL
  signature_path text,                          -- stored signature PNG (transaction-forms bucket)
  typed_name     text,                          -- exactly what the signer typed (attribution)
  consent_at     timestamptz,                   -- ESIGN electronic-records consent
  sent_at        timestamptz,
  viewed_at      timestamptz,
  signed_at      timestamptz,
  declined_at    timestamptz,
  decline_reason text,
  ip             text,
  user_agent     text,
  created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_env_signers_envelope ON crm_envelope_signers(envelope_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_env_signers_token ON crm_envelope_signers(access_token);
CREATE INDEX IF NOT EXISTS idx_env_signers_order ON crm_envelope_signers(envelope_id, signing_order);

-- 4. Audit trail — append-only. Every state change lands here for legal defensibility.
CREATE TABLE IF NOT EXISTS crm_envelope_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id uuid NOT NULL REFERENCES crm_envelopes(id) ON DELETE CASCADE,
  signer_id   uuid REFERENCES crm_envelope_signers(id) ON DELETE SET NULL,
  event       text NOT NULL,   -- created|sent|opened|viewed|signed|declined|completed|voided|reminder
  actor       text,            -- signer name/email, broker id, or 'system'
  ip          text,
  user_agent  text,
  meta        jsonb,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_env_events_envelope ON crm_envelope_events(envelope_id, created_at);

-- 5. Lock down: RLS on, no permissive policies → only the service role reaches these.
ALTER TABLE crm_envelopes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_envelope_signers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_envelope_events  ENABLE ROW LEVEL SECURITY;
