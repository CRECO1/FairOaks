-- Site filter for the Lead Attribution dashboard.
--
-- Why server-side: most panels are already aggregated in SQL (contact type,
-- geography, the portal feed, inbound-vs-imported over time) and the API returns
-- counts, not rows — so there is nothing for the client to filter. Filtering in
-- the browser could only ever scope "recent leads" and "leads by site", leaving
-- every other panel showing all-sites numbers under a single-site heading, which
-- is worse than no filter. One extra argument keeps every panel honest.
--
-- p_site null  -> the combined view, byte-for-byte what it was before.
-- p_site set   -> every panel scoped to that site.
--
-- The scoping for contact type / geography deliberately switches basis: the
-- combined view counts the whole contact book (3k rows, mostly imported lists),
-- while a single-site view counts only that site's inbound leads. Showing "all
-- 3,000 contacts" under a "elkhornpoint.com" heading would be a lie.

create or replace function public.lead_attribution_report(
  window_days int default 90,
  p_site text default null
)
returns jsonb
language sql
stable
as $$
with
since as (select now() - make_interval(days => greatest(window_days, 1)) as ts),
flt as (select nullif(btrim(coalesce(p_site, '')), '') as site),

raw_leads as (
  select l.created_at,
         public.lead_site_of(l.lead_site, l.source) as site,
         l.source,
         l.channel, l.utm_campaign, l.referrer, l.landing_page,
         coalesce(nullif(btrim(l.name), ''), '—') as name,
         lower(nullif(btrim(l.email), '')) as email_key,
         0 as src_rank
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
-- Cross-table dedupe only (see lead-attribution-unified.sql), then the filter.
deduped as (
  select r.* from raw_leads r
  where r.src_rank = 0
     or r.email_key is null
     or not exists (select 1 from public.leads l where lower(nullif(btrim(l.email), '')) = r.email_key)
),
all_leads as (
  select d.* from deduped d, flt
  where flt.site is null or d.site = flt.site
),

-- Contacts, scoped the same way when a site is selected.
scoped_clients as (
  select c.* from public.crm_clients c, flt
  where flt.site is null
     or (public.crm_lead_is_inbound(c.lead_source, c.lead_site, c.channel, c.utm_campaign, c.referrer, c.landing_page)
         and public.lead_site_of(c.lead_site, c.lead_source) = flt.site)
),

classified as (
  select date_trunc('month', created_at) as m,
         case when public.crm_lead_is_inbound(lead_source, lead_site, channel, utm_campaign, referrer, landing_page)
              then 'inbound' else 'imported' end as bucket
  from scoped_clients where created_at is not null
),
over_time as (
  select jsonb_agg(x order by x.month) as v from (
    select to_char(m,'YYYY-MM') as month,
           count(*) filter (where bucket='inbound')  as inbound,
           count(*) filter (where bucket='imported') as imported
    from classified group by m order by m desc limit 12
  ) x
),

channel_mix as (
  select jsonb_agg(x order by x.value desc) as v from (
    select coalesce(nullif(btrim(channel), ''), 'Not recorded') as label, count(*) as value
    from all_leads group by 1 order by 2 desc limit 10
  ) x
),

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
    from public.email_lead_imports e, flt
    where e.source is not null and btrim(e.source) <> ''
      and (flt.site is null or public.lead_site_of(e.lead_site, e.source) = flt.site)
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
    select type as label, count(*) as value from scoped_clients
    where type is not null and btrim(type) <> '' group by 1 order by 2 desc limit 8
  ) x
),

by_city as (
  select jsonb_agg(x order by x.value desc) as v from (
    select city as label, count(*) as value from scoped_clients
    where city is not null and btrim(city) <> '' group by 1 order by 2 desc limit 8
  ) x
),

-- When a site is selected the meter shows only that site.
site_list(site) as (
  select s from (values ('crecotx.com'), ('fairoaksrealtygroup.com'), ('elkhornpoint.com')) v(s), flt
  where flt.site is null or v.s = flt.site
),
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
  select (select count(*) from scoped_clients)  as clients,
         (select count(*) from public.email_lead_imports e, flt
           where flt.site is null or public.lead_site_of(e.lead_site, e.source) = flt.site) as imports,
         (select count(*) from all_leads)       as leads
)

select jsonb_build_object(
  'windowDays', window_days,
  'site',           (select site from flt),
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

-- Drop the old single-argument version so there is exactly one entry point and
-- no chance of PostgREST resolving to a stale overload.
drop function if exists public.lead_attribution_report(int);

revoke all on function public.lead_attribution_report(int, text) from public, anon, authenticated;
grant execute on function public.lead_attribution_report(int, text) to service_role;
