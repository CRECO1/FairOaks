-- ─────────────────────────────────────────────────────────────────────────────
-- Calling Log: every phone call the brokerage sees, in one place.
-- Additive + idempotent. Apply via the pooler / SQL editor like e-signatures.sql.
--
--   crm_call_log           one row per call — Talkroute call records, Talkroute
--                          voicemails, and calls the AI voice bot answered on Twilio.
--                          (Named crm_call_log: an older, empty, unused crm_calls table
--                          from an outbound-dialer scaffold already exists.)
--   crm_call_turns         the voice bot's conversation, one row per thing said
--   crm_voicebot_settings  per-business-unit switches: greeting, instructions,
--                          transfer number, who gets the summary email
--
-- Sources:
--   talkroute   pulled from the Talkroute API (/v2/call-history, /v2/voice-messages)
--               by the 15-minute cron, and pushed by Talkroute webhooks
--   voicebot    created live by the Twilio voice webhooks while the bot talks
--   manual      logged by an agent from the CRM
--
-- Access is service-role only (RLS on, no permissive policies) — every read/write
-- goes through an /api route. The Twilio + Talkroute webhook routes verify the
-- sender before touching these tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS crm_call_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit   text NOT NULL DEFAULT 'commercial',
  source          text NOT NULL DEFAULT 'talkroute',   -- talkroute | voicebot | manual
  kind            text NOT NULL DEFAULT 'call',        -- call | voicemail | bot
  external_id     text,                                -- Talkroute record id / voicemail id, Twilio CallSid
  direction       text NOT NULL DEFAULT 'inbound',     -- inbound | outbound
  result          text,                                -- answered | missed | hangup | voicemail | bot_answered | in_progress
  from_number     text,                                -- E.164 where we have it
  to_number       text,
  caller_name     text,                                -- CNAM, or what the caller told the bot
  contact_id      uuid REFERENCES crm_clients(id) ON DELETE SET NULL,
  deal_id         uuid REFERENCES crm_deals(id)   ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  duration_sec    integer,
  recording_url   text,                                -- Talkroute signed URL (temporary) or Twilio recording
  transcript      text,                                -- voicemail transcript, or the bot conversation flattened
  summary         text,                                -- AI summary (bot calls) or agent note
  intent          text,                                -- what the caller wanted, short label
  callback_number text,                                -- number the caller asked to be reached on
  needs_follow_up boolean NOT NULL DEFAULT false,
  handled_at      timestamptz,
  handled_by      uuid,
  notes           text,                                -- agent's own notes
  ai_meta         jsonb,                               -- structured facts the bot collected
  raw             jsonb,                               -- the provider payload, for debugging
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
-- One row per provider record, so the cron + webhook can both run without duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS idx_call_log_source_external ON crm_call_log(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_call_log_unit_started ON crm_call_log(business_unit, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_log_contact ON crm_call_log(contact_id);
CREATE INDEX IF NOT EXISTS idx_call_log_follow_up ON crm_call_log(business_unit, needs_follow_up) WHERE needs_follow_up;
CREATE INDEX IF NOT EXISTS idx_call_log_from ON crm_call_log(from_number);

CREATE TABLE IF NOT EXISTS crm_call_turns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id     uuid NOT NULL REFERENCES crm_call_log(id) ON DELETE CASCADE,
  role        text NOT NULL,          -- bot | caller
  text        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_turns_call ON crm_call_turns(call_id, created_at);

CREATE TABLE IF NOT EXISTS crm_voicebot_settings (
  business_unit     text PRIMARY KEY,
  enabled           boolean NOT NULL DEFAULT true,
  bot_name          text NOT NULL DEFAULT 'Ava',
  company_name      text,                              -- defaults by unit in code
  greeting          text,                              -- first thing the bot says; null = default
  instructions      text,                              -- extra guidance for the bot (hours, what to ask, what not to promise)
  transfer_number   text,                              -- E.164; when set, "talk to a person" dials this
  notify_emails     text[] NOT NULL DEFAULT '{}',      -- summary email recipients after each bot call
  twilio_number     text,                              -- the Twilio number Talkroute forwards to (E.164)
  talkroute_numbers text[] NOT NULL DEFAULT '{}',      -- Talkroute numbers that belong to this unit (E.164)
  updated_at        timestamptz DEFAULT now()
);

ALTER TABLE crm_call_log             ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_call_turns        ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_voicebot_settings ENABLE ROW LEVEL SECURITY;

-- Seed one settings row per unit so the UI always has something to edit.
INSERT INTO crm_voicebot_settings (business_unit, company_name, notify_emails)
VALUES ('commercial', 'CRECO', '{zack@crecotx.com}'), ('residential', 'Fair Oaks Realty Group', '{info@fairoaksrealtygroup.com}')
ON CONFLICT (business_unit) DO NOTHING;
