# AI / search crawler tracker

Every request to www.fairoaksrealtygroup.com whose user-agent matches a tracked bot
writes one row to `public.crawler_hits` (Supabase project `bnqdzgypesoythpbeujk`).
Human traffic is never logged.

- Detection + insert: `src/lib/crawler-hits.ts`, called from `src/middleware.ts`
  through `event.waitUntil()`, so the write happens after the response is sent and
  can never slow down or break a page.
- Schema + views: `supabase/crawler-hits.sql`.
- Retention: 365 days (pruned daily by `/api/cron/prune-pageviews`).

Tracked bots: GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User,
PerplexityBot, Perplexity-User, Googlebot, Bingbot, Applebot, Amazonbot,
Meta-ExternalAgent, CCBot, Bytespider.

| column | meaning |
|---|---|
| `bot_name` | canonical bot name (`GPTBot`, `ClaudeBot`, …) |
| `path` | pathname only; the query string is dropped so tokens and emails are never stored |
| `status` | set when middleware answered the request itself (`410` = expired listing). `null` = the page was rendered by the app, and middleware can't see that status. For full status codes use `vercel logs --status-code 404`. |
| `user_agent` | raw UA (first 512 chars) |
| `host` | request host |
| `created_at` | timestamp (UTC) |

User-agents can be spoofed. Googlebot in particular is often faked by scanners, so treat
the counts as a trend signal, not as verified crawler identity.

## Viewing it

Supabase dashboard → project **bnqdzgypesoythpbeujk** → **Table Editor**, and open one
of these views (or `select * from <view>` in the **SQL Editor**):

| view | shows |
|---|---|
| `crawler_hits_by_day` | hits per bot per day (Central time), including the count of 410s |
| `crawler_top_paths_30d` | most-crawled paths over the last 30 days and which bots hit them |
| `crawler_ai_files` | per bot: hits, first seen and last seen on `/llms.txt`, `/llms-full.txt`, `/sitemap.xml`, `/robots.txt` |

The views and the table are not exposed to the public API (anon and authenticated have
no grants). Only the dashboard and the service role can read them.

### Handy ad-hoc queries (SQL Editor)

```sql
-- AI bots only, last 14 days, by day
select (created_at at time zone 'America/Chicago')::date as day, bot_name, count(*)
  from crawler_hits
 where bot_name not in ('Googlebot', 'Bingbot')
   and created_at > now() - interval '14 days'
 group by 1, 2 order by 1 desc, 3 desc;

-- Did anyone fetch llms.txt / llms-full.txt yet?
select * from crawler_ai_files where path like '/llms%';

-- User-triggered AI fetches (someone asked ChatGPT/Claude/Perplexity about us)
select created_at, bot_name, path
  from crawler_hits
 where bot_name in ('ChatGPT-User', 'Claude-User', 'Perplexity-User')
 order by created_at desc limit 100;

-- Expired listings still being crawled (served 410)
select path, count(*), max(created_at)
  from crawler_hits where status = 410
 group by path order by 2 desc limit 50;
```

## Expired listings → 410 Gone

`/listings/<address>-<ListingId>` URLs for listings that have left SABOR's IDX feed
(sold, expired or withdrawn) now return **410 Gone**, not 404. Middleware checks
`/api/listings/exists?id=…`, which is CDN-cached for 30 minutes. A SABOR outage
returns 503 and falls through to the normal page, so it can never turn live listings
into 410s. The 410 body is the `/listing-unavailable` page, which shows "no longer on
the market", active alternatives and the get-matched form. `sitemap.xml` lists only
ACTIVE and ACTIVE_UNDER_CONTRACT listings, so dead slugs are never advertised.
