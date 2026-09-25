-- Lead Attribution aggregates, computed in the database.
--
-- Why an RPC and not a select: PostgREST caps a response at 1000 rows no
-- matter what .limit() asks for. Pulling crm_clients (3k rows and growing)
-- into the route and tallying in JS silently produced a chart of September
-- only — it rendered fine and was wrong. Aggregating here is both correct and
-- one round trip instead of three.
--
-- SECURITY: this function aggregates every agent's leads and the whole contact
-- book, which is owner-only data. It is NOT security definer, and EXECUTE is
-- revoked from anon/authenticated so a logged-in agent cannot call it directly
-- through PostgREST and sidestep the route's super_admin check. Only the
-- service role (used by the server route, after it verifies the caller) may
-- run it.

create or replace function public.lead_attribution_report(window_days int default 90)
returns jsonb
language sql
stable
as $$
with
since as (select now() - make_interval(days => greatest(window_days, 1)) as ts),

-- Inbound = arrived through a tracked web form. Everything else is a list we
-- built (county appraisal, broker imports, prospect lists).
classified as (
  select
    date_trunc('month', created_at) as m,
    case
      when channel is not null
        or lead_source ~* '(website|web lead|valuation|listing inquiry)'
      then 'inbound' else 'imported'
    end as bucket
  from public.crm_clients
  where created_at is not null
),
over_time as (
  select jsonb_agg(x order by x.month) as v from (
    select to_char(m, 'YYYY-MM') as month,
           count(*) filter (where bucket = 'inbound')  as inbound,
           count(*) filter (where bucket = 'imported') as imported
    from classified
    group by m
    order by m desc
    limit 12
  ) x
),

channel_mix as (
  select jsonb_agg(x order by x.value desc) as v from (
    select case
             when source ~* 'crexi'   then 'Crexi'
             when source ~* 'loopnet' then 'LoopNet'
             when source ~* 'costar'  then 'CoStar'
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

capture_surface as (
  select jsonb_agg(x order by x.value desc) as v from (
    select coalesce(nullif(btrim(source), ''), '(unknown)') as label, count(*) as value
    from public.leads group by 1 order by 2 desc limit 10
  ) x
),

by_type as (
  select jsonb_agg(x order by x.value desc) as v from (
    select type as label, count(*) as value
    from public.crm_clients
    where type is not null and btrim(type) <> ''
    group by 1 order by 2 desc limit 8
  ) x
),

by_city as (
  select jsonb_agg(x order by x.value desc) as v from (
    select city as label, count(*) as value
    from public.crm_clients
    where city is not null and btrim(city) <> ''
    group by 1 order by 2 desc limit 8
  ) x
),

-- Attribution health: of the leads that came through a web form in the
-- window, how many recorded where they came from.
health_forg as (
  select count(*) as total,
         count(*) filter (
           where channel is not null or utm_campaign is not null
              or referrer is not null or landing_page is not null
         ) as with_attr
  from public.leads, since
  where created_at >= since.ts
),
health_crm as (
  select count(*) as total,
         count(*) filter (
           where channel is not null or utm_campaign is not null
              or referrer is not null or landing_page is not null
         ) as with_attr
  from public.crm_clients, since
  where created_at >= since.ts
    and (channel is not null or lead_source ~* '(website|web lead)')
),

recent as (
  select jsonb_agg(x order by x.date desc) as v from (
    select coalesce(name, '—') as name, created_at as date, source,
           channel, utm_campaign as campaign, referrer, landing_page
    from public.leads
    order by created_at desc nulls last
    limit 40
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
  'captureSurface', coalesce((select v from capture_surface), '[]'::jsonb),
  'byType',         coalesce((select v from by_type), '[]'::jsonb),
  'byCity',         coalesce((select v from by_city), '[]'::jsonb),
  'recent',         coalesce((select v from recent), '[]'::jsonb),
  'health', jsonb_build_object(
    'windowDays', window_days,
    'sites', jsonb_build_array(
      jsonb_build_object(
        'site', 'fairoaksrealtygroup.com',
        'total', (select total from health_forg),
        'withAttribution', (select with_attr from health_forg),
        'pct', case when (select total from health_forg) > 0
                    then round(100.0 * (select with_attr from health_forg) / (select total from health_forg))
                    else null end
      ),
      jsonb_build_object(
        'site', 'CRM contacts (web leads)',
        'total', (select total from health_crm),
        'withAttribution', (select with_attr from health_crm),
        'pct', case when (select total from health_crm) > 0
                    then round(100.0 * (select with_attr from health_crm) / (select total from health_crm))
                    else null end
      )
    )
  ),
  'counts', (select jsonb_build_object('clients', clients, 'imports', imports, 'leads', leads) from counts)
);
$$;

-- Owner-only data: keep this off the public PostgREST surface entirely.
revoke all on function public.lead_attribution_report(int) from public;
revoke all on function public.lead_attribution_report(int) from anon;
revoke all on function public.lead_attribution_report(int) from authenticated;
grant execute on function public.lead_attribution_report(int) to service_role;
