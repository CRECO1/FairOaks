-- Missed calls / voicemails / bot call-backs auto-route to one agent per workspace (2026-10-12).
-- Null = the older rule (contact's agent, then listing owner, then unit default). Additive + idempotent.
alter table crm_voicebot_settings add column if not exists missed_call_assignee uuid references crm_profiles(id) on delete set null;
