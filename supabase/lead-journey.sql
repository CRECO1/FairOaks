-- Per-lead visit journey + dwell — answers, for a named lead, "what pages did
-- they visit, and how long were they here before they left".
--
-- The browser records the ordered page trail in sessionStorage (see
-- src/lib/attribution.ts: recordJourneyStep) and spreads it into the lead POST
-- alongside the seconds-on-site; the server sanitises it (src/lib/lead-context.ts)
-- and stores it next to the lead. `journey` is a JSON array of {p, t} where p is
-- the path and t is milliseconds after the first page view of the visit.
--
-- The report that surfaces these to the CRM lives in lead-attribution-v2.sql —
-- the `recent` array now carries journey / time_on_site_sec / page_views, which
-- the Lead Attribution page renders as an expandable "pages · time on site"
-- cell. Run this file first (adds the columns), then re-run lead-attribution-v2.sql.
--
-- Backfill: none. These populate for leads captured after deploy; older rows
-- keep null and the UI shows a dash.

alter table public.leads       add column if not exists journey          jsonb;
alter table public.leads       add column if not exists time_on_site_sec integer;
alter table public.leads       add column if not exists page_views       integer;

alter table public.crm_clients add column if not exists journey          jsonb;
alter table public.crm_clients add column if not exists time_on_site_sec integer;
alter table public.crm_clients add column if not exists page_views       integer;
