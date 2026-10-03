-- AI / search crawler tracker. src/middleware.ts writes ONE row per request whose
-- user-agent matches a tracked bot (GPTBot, OAI-SearchBot, ChatGPT-User,
-- ClaudeBot, Claude-User, PerplexityBot, Perplexity-User, Googlebot, Bingbot,
-- Applebot, Amazonbot, Meta-ExternalAgent, CCBot, Bytespider — see
-- src/lib/crawler-hits.ts). Human traffic is never logged. Fire-and-forget insert
-- via PostgREST with the service-role key. Retention: 365 days, pruned daily by
-- /api/cron/prune-pageviews. How to read it: docs/crawler-tracker.md.

create table if not exists public.crawler_hits (
  id          bigint generated always as identity primary key,
  bot_name    text not null,               -- canonical name, e.g. 'GPTBot'
  path        text not null,               -- pathname only, never the query string
  status      smallint,                    -- set when middleware answered (e.g. 410); null = rendered by the app
  user_agent  text not null,
  host        text,
  created_at  timestamptz not null default now()
);

create index if not exists crawler_hits_created_idx     on public.crawler_hits (created_at desc);
create index if not exists crawler_hits_bot_created_idx on public.crawler_hits (bot_name, created_at desc);

-- Service-role only: RLS on, no policies, so anon/authenticated get nothing.
alter table public.crawler_hits enable row level security;
revoke all on public.crawler_hits from anon, authenticated;

-- ─── Read-side views (Supabase dashboard → Table Editor / SQL Editor) ────────
-- security_invoker so they obey the table's RLS rather than the view owner's,
-- and revoked from the API roles so PostgREST never exposes them.

create or replace view public.crawler_hits_by_day with (security_invoker = true) as
  select (created_at at time zone 'America/Chicago')::date as day,
         bot_name,
         count(*)                                   as hits,
         count(*) filter (where status = 410)       as gone_410,
         count(distinct path)                       as distinct_paths
    from public.crawler_hits
   group by 1, 2
   order by 1 desc, 3 desc;

create or replace view public.crawler_top_paths_30d with (security_invoker = true) as
  select path,
         count(*)                                   as hits,
         count(distinct bot_name)                   as bots,
         string_agg(distinct bot_name, ', ')        as bot_names,
         max(created_at)                            as last_hit
    from public.crawler_hits
   where created_at > now() - interval '30 days'
   group by path
   order by hits desc;

create or replace view public.crawler_ai_files with (security_invoker = true) as
  select bot_name,
         path,
         count(*)        as hits,
         min(created_at) as first_hit,
         max(created_at) as last_hit
    from public.crawler_hits
   where path in ('/llms.txt', '/llms-full.txt', '/sitemap.xml', '/robots.txt')
   group by bot_name, path
   order by bot_name, path;

revoke all on public.crawler_hits_by_day, public.crawler_top_paths_30d, public.crawler_ai_files
  from anon, authenticated;
