-- Gmail reply/"contacted" scans, cached so the campaign call list does not wait on
-- ~40 sequential Gmail searches + hundreds of message reads on a cold instance.
-- One row per scan; reads take the newest rows for (conn_id, direction) and use the first
-- one that covers the addresses being asked about (lib/campaign-replies.ts). Service role
-- only: RLS is on with no policies.
create table if not exists crm_gmail_scan_cache (
  id           uuid primary key default gen_random_uuid(),
  conn_id      uuid not null,
  direction    text not null check (direction in ('in', 'out')),
  after_at     timestamptz not null,
  addrs        text[] not null default '{}',
  found        jsonb not null default '[]'::jsonb,
  computed_at  timestamptz not null default now()
);
create index if not exists crm_gmail_scan_cache_lookup on crm_gmail_scan_cache (conn_id, direction, computed_at desc);
alter table crm_gmail_scan_cache enable row level security;
