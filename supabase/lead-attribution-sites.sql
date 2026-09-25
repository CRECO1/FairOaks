-- Three-site lead attribution: crecotx.com, fairoaksrealtygroup.com,
-- elkhornpoint.com.
--
-- Rows written from today carry lead_site explicitly. Everything already in the
-- tables predates that column, so the site is inferred from the source text —
-- which is reliable because each site writes a distinctive label:
--
--   elkhornpoint.com  -> leads.source  'elkhornpoint.com' / 'elkhornpoint.com (fast capture)'
--                        crm_clients   lead_source 'website — elkhornpoint.com (campaign)'
--                        (also tagged 'Elkhorn Point' + 'Prospective Tenant')
--   crecotx.com       -> 'CRECO Website…' from the Gmail importer, or the CRM webhook
--   fairoaks…         -> 'Website' / 'Home valuation — fairoaksrealtygroup.com'
--
-- Anything that matches none of those is a list we built or an off-site portal,
-- and is reported as "Other / imported" rather than silently folded into one of
-- the three sites.

create or replace function public.lead_site_of(p_site text, p_source text)
returns text
language sql
immutable
as $$
  select case
    when p_site is not null and btrim(p_site) <> '' then p_site
    when p_source ~* 'elkhorn'                      then 'elkhornpoint.com'
    when p_source ~* 'creco'                        then 'crecotx.com'
    when p_source ~* '(fairoaks|home valuation|^website$|web lead|^contact$|^listing$|^valuation$|^quiz$|tour-request|tenant-needs|agent-application)'
                                                    then 'fairoaksrealtygroup.com'
    else 'Other / imported'
  end;
$$;

-- Rebuilt report: per-site health, per-site channel mix, site on every lead row.
create or replace function public.lead_attribution_report(window_days int default 90)
returns jsonb
language sql
stable
as $$
with
since as (select now() - make_interval(days => greatest(window_days, 1)) as ts),

-- Every lead-ish row from both tables, normalised to one shape with a site.
all_leads as (
  select
    l.created_at,
    public.lead_site_of(l.lead_site, l.source) as site,
    l.source,
    l.channel, l.utm_campaign, l.referrer, l.landing_page,
    coalesce(l.name, '—') as name
  from public.leads l
),

classified as (
  select
    date_trunc('month', created_at) as m,
    case when channel is not null or lead_source ~* '(website|web lead|valuation|listing inquiry|elkhorn)'
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

-- Channel mix, split by site so elkhorn is never folded into "Website".
channel_mix as (
  select jsonb_agg(x order by x.value desc) as v from (
    select case
             when source ~* 'crexi'   then 'Crexi'
             when source ~* 'loopnet' then 'LoopNet'
             when source ~* 'costar'  then 'CoStar'
             when source ~* 'elkhorn' then 'Elkhorn Point site'
             when source ~* 'creco'   then 'CRECO Website'
             when source ~* 'website' then 'Website'
             else left(source, 40)
           end as label,
           count(*) as value
    from public.email_lead_imports
    where source is not null and btrim(source) <> ''
    group by 1 order by 2 desc limit 10
  ) x
),

by_site as (
  select jsonb_agg(x order by x.value desc) as v from (
    select site as label, count(*) as value
    from all_leads group by 1 order by 2 desc
  ) x
),

capture_surface as (
  select jsonb_agg(x order by x.value desc) as v from (
    select coalesce(nullif(btrim(source),''),'(unknown)') as label, count(*) as value
    from public.leads group by 1 order by 2 desc limit 10
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

-- Per-site attribution health over the window. Every one of the three sites is
-- listed even at zero leads: an absent row would read as "fine" when it
-- actually means "this site sends us nothing we can see".
site_list(site) as (values ('crecotx.com'), ('fairoaksrealtygroup.com'), ('elkhornpoint.com')),
health_rows as (
  select s.site,
         count(a.*) as total,
         count(a.*) filter (
           where a.channel is not null or a.utm_campaign is not null
              or a.referrer is not null or a.landing_page is not null
         ) as with_attr
  from site_list s
  left join all_leads a
    on a.site = s.site and a.created_at >= (select ts from since)
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
         (select count(*) from public.leads)              as leads
)

select jsonb_build_object(
  'windowDays', window_days,
  'overTime',       coalesce((select v from over_time), '[]'::jsonb),
  'channelMix',     coalesce((select v from channel_mix), '[]'::jsonb),
  'bySite',         coalesce((select v from by_site), '[]'::jsonb),
  'captureSurface', coalesce((select v from capture_surface), '[]'::jsonb),
  'byType',         coalesce((select v from by_type), '[]'::jsonb),
  'byCity',         coalesce((select v from by_city), '[]'::jsonb),
  'recent',         coalesce((select v from recent), '[]'::jsonb),
  'health', jsonb_build_object(
    'windowDays', window_days,
    'sites', coalesce((select v from health), '[]'::jsonb)
  ),
  'counts', (select jsonb_build_object('clients',clients,'imports',imports,'leads',leads) from counts)
);
$$;

revoke all on function public.lead_attribution_report(int) from public;
revoke all on function public.lead_attribution_report(int) from anon;
revoke all on function public.lead_attribution_report(int) from authenticated;
grant execute on function public.lead_attribution_report(int) to service_role;

revoke all on function public.lead_site_of(text, text) from public;
revoke all on function public.lead_site_of(text, text) from anon;
revoke all on function public.lead_site_of(text, text) from authenticated;
grant execute on function public.lead_site_of(text, text) to service_role;
