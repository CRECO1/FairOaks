-- Unified lead counting: public.leads  UNION  the inbound web leads in
-- public.crm_clients.
--
-- Two problems this fixes.
--
-- 1. WEBHOOK LEADS WERE INVISIBLE. The health meter and "Leads by site" read
--    public.leads only. Leads that arrive through /api/webhook/lead — which is
--    now every elkhornpoint.com lead, and crecotx.com's — are written straight
--    to crm_clients and never touch public.leads. A verified elkhorn lead sat
--    in crm_clients with all 14 attribution columns populated while the meter
--    read "elkhornpoint.com 0%". The panels would have stayed at zero forever
--    while attribution worked perfectly.
--
-- 2. PROSPECT LISTS WERE COUNTED AS INBOUND. The previous inbound test matched
--    the bare word 'elkhorn', so "Elkhorn Prospect List" (214 rows) and
--    "Elkhorn Back Pad Prospect List" (66) — lists we built — were counted as
--    inbound leads. That inflated inbound by 280 and is exactly backwards: they
--    are the definition of imported.
--
-- Dedupe: a lead can legitimately exist in both tables (the FORG /api/leads
-- route writes to public.leads AND creates a crm_clients contact). The dedupe
-- is deliberately CROSS-TABLE ONLY: a crm_clients row is dropped when its email
-- already appears in public.leads, and every public.leads row is kept untouched.
--
-- It does NOT collapse repeat submissions within a table. The same address
-- submitting the form seven times is seven enquiries, possibly months apart —
-- folding those into one would quietly rewrite the existing leads-table counts
-- and hide genuine repeat interest. Rows with no email cannot be matched and
-- are all kept: under-counting a duplicate is better than dropping a real lead.

-- ── Is this contact an inbound web lead, or something we imported? ──────────
-- Attribution of any kind proves a web form produced it. Otherwise the
-- lead_source has to look like a website AND not look like a list.
create or replace function public.crm_lead_is_inbound(
  p_lead_source text, p_lead_site text, p_channel text,
  p_utm_campaign text, p_referrer text, p_landing_page text
) returns boolean
language sql
immutable
as $$
  select
    -- Anything carrying real attribution came through a tracked form.
    coalesce(p_lead_site, p_channel, p_utm_campaign, p_referrer, p_landing_page) is not null
    or (
      -- Named lists and feeds are never inbound, however they are worded.
      p_lead_source !~* '(prospect|list|import|appraisal|property db|dentwizard|marketed listing|broker)'
      and p_lead_source ~* '(website|web lead|home valuation|contact form|listing inquiry|tour request|tenant rep|sell / list|valuation tool|market report|agent application|elkhornpoint\.com|crecotx\.com|fairoaksrealtygroup\.com)'
    );
$$;

create or replace function public.lead_attribution_report(window_days int default 90)
returns jsonb
language sql
stable
as $$
with
since as (select now() - make_interval(days => greatest(window_days, 1)) as ts),

-- Every lead-ish row from both tables in one shape.
raw_leads as (
  select l.created_at,
         public.lead_site_of(l.lead_site, l.source) as site,
         l.source,
         l.channel, l.utm_campaign, l.referrer, l.landing_page,
         coalesce(nullif(btrim(l.name), ''), '—') as name,
         lower(nullif(btrim(l.email), '')) as email_key,
         0 as src_rank                       -- public.leads wins a tie
  from public.leads l
  union all
  select c.created_at,
         public.lead_site_of(c.lead_site, c.lead_source) as site,
         c.lead_source as source,
         c.channel, c.utm_campaign, c.referrer, c.landing_page,
         coalesce(nullif(btrim(coalesce(c.first_name,'') || ' ' || coalesce(c.last_name,'')), ''), '—') as name,
         lower(nullif(btrim(c.email), '')) as email_key,
         1 as src_rank
  from public.crm_clients c
  where public.crm_lead_is_inbound(c.lead_source, c.lead_site, c.channel, c.utm_campaign, c.referrer, c.landing_page)
),
all_leads as (
  select r.* from raw_leads r
  where r.src_rank = 0                        -- every public.leads row is kept
     or r.email_key is null                   -- unmatchable, so kept
     or not exists (                          -- crm_clients row already counted in leads
          select 1 from public.leads l
          where lower(nullif(btrim(l.email), '')) = r.email_key
        )
),

-- Inbound vs imported across the whole contact book, using the same test.
classified as (
  select date_trunc('month', created_at) as m,
         case when public.crm_lead_is_inbound(lead_source, lead_site, channel, utm_campaign, referrer, landing_page)
              then 'inbound' else 'imported' end as bucket
  from public.crm_clients
  where created_at is not null
),
over_time as (
  select jsonb_agg(x order by x.month) as v from (
    select to_char(m,'YYYY-MM') as month,
           count(*) filter (where bucket='inbound')  as inbound,
           count(*) filter (where bucket='imported') as imported
    from classified group by m order by m desc limit 12
  ) x
),

-- True acquisition channel of the unified leads.
channel_mix as (
  select jsonb_agg(x order by x.value desc) as v from (
    select coalesce(nullif(btrim(channel), ''), 'Not recorded') as label, count(*) as value
    from all_leads group by 1 order by 2 desc limit 10
  ) x
),

-- The portal / importer feed, which is a different question from "channel".
inbound_feed as (
  select jsonb_agg(x order by x.value desc) as v from (
    select case
             when source ~* 'crexi'   then 'Crexi'
             when source ~* 'loopnet' then 'LoopNet'
             when source ~* 'costar'  then 'CoStar'
             when source ~* 'elkhorn' then 'Elkhorn Point site'
             when source ~* 'creco'   then 'CRECO Website'
             when source ~* 'website' then 'Website'
             else left(source, 40)
           end as label, count(*) as value
    from public.email_lead_imports
    where source is not null and btrim(source) <> ''
    group by 1 order by 2 desc limit 10
  ) x
),

by_site as (
  select jsonb_agg(x order by x.value desc) as v from (
    select site as label, count(*) as value from all_leads group by 1 order by 2 desc
  ) x
),

capture_surface as (
  select jsonb_agg(x order by x.value desc) as v from (
    select coalesce(nullif(btrim(source),''),'(unknown)') as label, count(*) as value
    from all_leads group by 1 order by 2 desc limit 10
  ) x
),

by_type as (
  select jsonb_agg(x order by x.value desc) as v from (
    select type as label, count(*) as value from public.crm_clients
    where type is not null and btrim(type) <> '' group by 1 order by 2 desc limit 8
  ) x
),

by_city as (
  select jsonb_agg(x order by x.value desc) as v from (
    select city as label, count(*) as value from public.crm_clients
    where city is not null and btrim(city) <> '' group by 1 order by 2 desc limit 8
  ) x
),

site_list(site) as (values ('crecotx.com'), ('fairoaksrealtygroup.com'), ('elkhornpoint.com')),
health_rows as (
  select s.site,
         count(a.*) as total,
         count(a.*) filter (
           where a.channel is not null or a.utm_campaign is not null
              or a.referrer is not null or a.landing_page is not null
         ) as with_attr
  from site_list s
  left join all_leads a on a.site = s.site and a.created_at >= (select ts from since)
  group by s.site
),
health as (
  select jsonb_agg(jsonb_build_object(
    'site', site, 'total', total, 'withAttribution', with_attr,
    'pct', case when total > 0 then round(100.0 * with_attr / total) else null end
  ) order by site) as v from health_rows
),

recent as (
  select jsonb_agg(x order by x.date desc) as v from (
    select name, created_at as date, source, site, channel,
           utm_campaign as campaign, referrer, landing_page
    from all_leads order by created_at desc nulls last limit 40
  ) x
),

counts as (
  select (select count(*) from public.crm_clients)        as clients,
         (select count(*) from public.email_lead_imports) as imports,
         (select count(*) from all_leads)                 as leads
)

select jsonb_build_object(
  'windowDays', window_days,
  'overTime',       coalesce((select v from over_time), '[]'::jsonb),
  'channelMix',     coalesce((select v from channel_mix), '[]'::jsonb),
  'inboundFeed',    coalesce((select v from inbound_feed), '[]'::jsonb),
  'bySite',         coalesce((select v from by_site), '[]'::jsonb),
  'captureSurface', coalesce((select v from capture_surface), '[]'::jsonb),
  'byType',         coalesce((select v from by_type), '[]'::jsonb),
  'byCity',         coalesce((select v from by_city), '[]'::jsonb),
  'recent',         coalesce((select v from recent), '[]'::jsonb),
  'health', jsonb_build_object('windowDays', window_days, 'sites', coalesce((select v from health), '[]'::jsonb)),
  'counts', (select jsonb_build_object('clients',clients,'imports',imports,'leads',leads) from counts)
);
$$;

revoke all on function public.lead_attribution_report(int) from public, anon, authenticated;
grant execute on function public.lead_attribution_report(int) to service_role;
revoke all on function public.crm_lead_is_inbound(text,text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.crm_lead_is_inbound(text,text,text,text,text,text) to service_role;
