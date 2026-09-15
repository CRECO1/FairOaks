-- Text messages on the Talkroute numbers, one row per message. Fed by the same
-- 15-minute cron as calls plus the `new_text_message` webhook. Replies sent from
-- the CRM go out through Talkroute's messaging API and land here as outbound rows.
-- Service-role only (RLS on, no policies), like crm_call_log.

CREATE TABLE IF NOT EXISTS crm_text_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit   text NOT NULL DEFAULT 'commercial',
  source          text NOT NULL DEFAULT 'talkroute',
  external_id     text,                                -- Talkroute message id (or push:… until the sync reconciles)
  conversation_id text NOT NULL,                       -- "<talkroute number>-<contact number>", Talkroute's own key
  direction       text NOT NULL,                       -- inbound | outbound
  from_number     text,
  to_number       text,
  body            text,
  attachments     jsonb,
  contact_id      uuid REFERENCES crm_clients(id) ON DELETE SET NULL,
  sent_by         text,                                -- Talkroute user email for outbound
  sent_at         timestamptz NOT NULL DEFAULT now(),
  read            boolean NOT NULL DEFAULT false,
  needs_follow_up boolean NOT NULL DEFAULT false,      -- latest message in the thread is inbound and unanswered
  handled_at      timestamptz,
  handled_by      uuid,
  raw             jsonb,
  created_at      timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_texts_source_external ON crm_text_messages(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_texts_conversation ON crm_text_messages(conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_texts_unit_sent ON crm_text_messages(business_unit, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_texts_contact ON crm_text_messages(contact_id);
ALTER TABLE crm_text_messages ENABLE ROW LEVEL SECURITY;
