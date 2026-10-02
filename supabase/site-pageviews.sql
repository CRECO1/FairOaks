-- Live first-party pageview stream for the real-time activity feed on the CRM
-- Lead Attribution page. A fire-and-forget beacon from both public sites hits
-- /api/track/pageview, which writes a row here. Rolling window (pruned to 7
-- days by cron/prune-pageviews). The CRM reads it ONLY through a service-role
-- API — the browser never touches this table.

create table if not exists public.site_pageviews (
  id           bigint generated always as identity primary key,
  site         text not null,              -- host: crecotx.com | fairoaksrealtygroup.com | elkhornpoint.com
  session_id   text not null,              -- anonymous per-tab id from the client (no PII)
  path         text not null,
  title        text,
  referrer     text,
  utm_source   text,
  utm_medium   text,
  utm_campaign text,
  utm_term     text,
  utm_content  text,
  country      text,                        -- from the edge geo headers
  region       text,
  city         text,
  device       text,                        -- mobile | tablet | desktop (from UA)
  created_at   timestamptz not null default now()
);

create index if not exists site_pageviews_created_idx       on public.site_pageviews (created_at desc);
create index if not exists site_pageviews_site_created_idx  on public.site_pageviews (site, created_at desc);
create index if not exists site_pageviews_session_idx       on public.site_pageviews (session_id, created_at desc);

-- No authenticated/anon access: the browser never reads this, and both the
-- ingest route and the CRM live-activity API use the service-role key (which
-- bypasses RLS). With RLS on and no policies, every other role is denied.
alter table public.site_pageviews enable row level security;
