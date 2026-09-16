-- Open tracking for action-plan emails (welcome sequence, closed-deal congrats, etc.).
-- crm_action_plan_sends already existed (scaffolded, unused) — add the open-tracking
-- columns, mirroring crm_campaign_sends. A 1×1 pixel in each email pings
-- /api/track/open?type=action_plan&id=<tracking_id>, which stamps opened_at/open_count.
alter table crm_action_plan_sends
  add column if not exists tracking_id uuid,
  add column if not exists opened_at   timestamptz,
  add column if not exists open_count  int default 0;
create index if not exists crm_action_plan_sends_tracking_idx on crm_action_plan_sends(tracking_id);
create index if not exists crm_action_plan_sends_plan_idx     on crm_action_plan_sends(plan_id);
