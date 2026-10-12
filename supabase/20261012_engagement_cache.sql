-- Engagement results (campaign list funnels + the Marketing call list), kept so a cold
-- server instance answers from one row instead of ~20 sequential reads. Served
-- stale-while-revalidate by lib/engagement-cache.ts; refreshed by /api/cron/reply-scan.
-- Service role only: RLS on, no policies. Safe to truncate at any time.
create table if not exists crm_engagement_cache (
  key          text primary key,
  payload      jsonb not null,
  computed_at  timestamptz not null default now()
);
alter table crm_engagement_cache enable row level security;
