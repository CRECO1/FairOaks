-- Lead attribution report v3 — `recent` rows now also carry the contact id (client_id) and the v2 tracker fields
-- (visitor_id, visit_count, first_touch, click_ids, env). Requires tracking-v2.sql (adds the columns) first.
-- CREATE OR REPLACE keeps the existing EXECUTE grants (revoked from `authenticated`; service role only).
CREATE OR REPLACE FUNCTION public.lead_attribution_report(window_days integer DEFAULT 90, p_site text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
with
cfg as (
  select greatest(coalesce(window_days, 90), 1)                     as days,
         now() - make_interval(days => greatest(coalesce(window_days,90),1)) as since,
         nullif(btrim(coalesce(p_site,'')),'')                      as site,
         -- A monthly bar chart over 30 days is one bar. Granularity follows the
         -- window so the trend panel is readable at every range.
         case when greatest(coalesce(window_days,90),1) <= 31  then 'day'
              when greatest(coalesce(window_days,90),1) <= 120 then 'week'
              else 'month' end                                      as grain
),

raw_leads as (
  select l.created_at,
         public.lead_site_of(l.lead_site, l.source) as site,
         l.source, l.channel, l.utm_campaign, l.utm_content, l.referrer, l.landing_page,
         l.journey, l.time_on_site_sec, l.page_views,
         l.visitor_id, l.visit_count, l.first_touch, l.click_ids, l.env,
         coalesce(nullif(btrim(l.name),''),'') as name,
         lower(nullif(btrim(l.email),'')) as email_key,
         0 as src_rank
  from public.leads l
  where not public.lead_is_test(l.name, l.email)
  union all
  select c.created_at,
         public.lead_site_of(c.lead_site, c.lead_source) as site,
         c.lead_source, c.channel, c.utm_campaign, c.utm_content, c.referrer, c.landing_page,
         c.journey, c.time_on_site_sec, c.page_views,
         c.visitor_id, c.visit_count, c.first_touch, c.click_ids, c.env,
         coalesce(nullif(btrim(coalesce(c.first_name,'')||' '||coalesce(c.last_name,'')),''),'') as name,
         lower(nullif(btrim(c.email),'')) as email_key,
         1 as src_rank
  from public.crm_clients c
  where public.crm_lead_is_inbound(c.lead_source, c.lead_site, c.channel, c.utm_campaign, c.referrer, c.landing_page)
    and not public.lead_is_test(coalesce(c.first_name,'')||' '||coalesce(c.last_name,''), c.email)
),
-- Cross-table dedupe only: never collapse repeat submissions within a table.
deduped as (
  select r.* from raw_leads r
  where r.src_rank = 0
     or r.email_key is null
     or not exists (select 1 from public.leads l where lower(nullif(btrim(l.email),'')) = r.email_key)
),
all_leads as (
  select d.* from deduped d, cfg
  where d.created_at >= cfg.since
    and (cfg.site is null or d.site = cfg.site)
),
-- Type and geography come off the matching contact record; a raw lead row with
-- no contact yet simply has none, which is honest rather than invented.
enriched as (
  select a.*, k.type as client_type, k.city as client_city
  from all_leads a
  left join lateral (
    select type, city from public.crm_clients k
    where a.email_key is not null and lower(btrim(k.email)) = a.email_key limit 1
  ) k on true
),

total as (select count(*) n from all_leads),

rank_site as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select site as label, count(*) as value from all_leads group by 1 order by 2 desc limit 8) x),
rank_channel as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select coalesce(nullif(btrim(channel),''),'Not recorded') as label, count(*) as value
    from all_leads group by 1 order by 2 desc limit 8) x),
rank_campaign as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select coalesce(nullif(btrim(utm_campaign),''),'No campaign') as label, count(*) as value
    from all_leads group by 1 order by 2 desc limit 8) x),

over_time as (
  select coalesce(jsonb_agg(x order by x.bucket), '[]'::jsonb) v from (
    select to_char(date_trunc((select grain from cfg), created_at), 'YYYY-MM-DD') as bucket,
           count(*) as leads
    from all_leads group by 1 order by 1) x),

capture_surface as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select coalesce(nullif(btrim(source),''),'(unknown)') as label, count(*) as value
    from all_leads group by 1 order by 2 desc limit 8) x),

inbound_feed as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select case when e.source ~* 'crexi' then 'Crexi'
                when e.source ~* 'loopnet' then 'LoopNet'
                when e.source ~* 'costar' then 'CoStar'
                when e.source ~* 'elkhorn' then 'Elkhorn Point site'
                when e.source ~* 'creco' then 'CRECO Website'
                when e.source ~* 'website' then 'Website'
                else left(e.source,40) end as label,
           count(*) as value
    from public.email_lead_imports e, cfg
    where e.source is not null and btrim(e.source) <> ''
      and e.created_at >= cfg.since
      and (cfg.site is null or public.lead_site_of(e.lead_site, e.source) = cfg.site)
      and not public.lead_is_test(e.parsed_name, e.parsed_email)
    group by 1 order by 2 desc limit 8) x),

by_type as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select client_type as label, count(*) as value from enriched
    where client_type is not null and btrim(client_type) <> '' group by 1 order by 2 desc limit 6) x),
by_city as (
  select coalesce(jsonb_agg(x order by x.value desc), '[]'::jsonb) v from (
    select client_city as label, count(*) as value from enriched
    where client_city is not null and btrim(client_city) <> '' group by 1 order by 2 desc limit 6) x),

-- ── Email campaign performance ───────────────────────────────────────────────
-- Join a campaign to its leads by the utm_campaign inside its own email body;
-- the campaign name is never the utm value.
camp as (
  select c.id, c.name,
         substring(c.email_body from 'utm_campaign=([A-Za-z0-9_\-]+)') as utm
  from public.crm_campaigns c
),
camp_sends as (
  select s.campaign_id,
         count(*) filter (where s.status='sent') sent,
         count(s.opened_at) pixel_opens
  from public.crm_campaign_sends s, cfg
  where s.sent_at >= cfg.since
  group by 1),
camp_events as (
  select e.campaign_id,
         count(distinct e.client_id) filter (where e.event_type='click') clickers,
         count(distinct e.client_id) filter (where e.event_type='open')  webhook_openers
  from public.email_tracking_events e, cfg
  where e.occurred_at >= cfg.since group by 1),
camp_leads as (
  select c.id, count(a.*) n
  from camp c left join all_leads a on a.utm_campaign = c.utm and c.utm is not null
  group by c.id),
campaign_perf as (
  select coalesce(jsonb_agg(x order by x.sent desc), '[]'::jsonb) v from (
    select c.name, c.utm,
           cs.sent,
           greatest(coalesce(cs.pixel_opens,0), coalesce(ce.webhook_openers,0)) opens,
           coalesce(ce.clickers,0) clicks,
           coalesce(cl.n,0) leads
    from camp c
    join camp_sends cs on cs.campaign_id = c.id
    left join camp_events ce on ce.campaign_id = c.id
    left join camp_leads  cl on cl.id = c.id
    where cs.sent > 0
    order by cs.sent desc limit 12) x),

site_list(site) as (
  select s from (values ('crecotx.com'),('fairoaksrealtygroup.com'),('elkhornpoint.com')) v(s), cfg
  where cfg.site is null or v.s = cfg.site),
health as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'site', site, 'total', total, 'withAttribution', with_attr,
    'pct', case when total > 0 then round(100.0*with_attr/total) else null end) order by site), '[]'::jsonb) v
  from (
    select s.site, count(a.*) total,
           count(a.*) filter (where a.channel is not null or a.utm_campaign is not null
                                 or a.referrer is not null or a.landing_page is not null) with_attr
    from site_list s left join all_leads a on a.site = s.site group by s.site) t),

recent as (
  select coalesce(jsonb_agg(x order by x.date desc), '[]'::jsonb) v from (
    select name, created_at as date, source, site, channel,
           utm_campaign as campaign, utm_content as content, referrer, landing_page,
           journey, time_on_site_sec, page_views,
           visitor_id, visit_count, first_touch, click_ids, env,
           -- the contact this lead became, so the CRM can open its full website activity
           (select k.id from public.crm_clients k where lower(nullif(btrim(k.email),'')) = all_leads.email_key
             order by k.created_at limit 1) as client_id
    from all_leads
    where name <> ''            -- a bare em-dash row is noise, not a lead
    order by created_at desc limit 200) x)

select jsonb_build_object(
  'windowDays', (select days from cfg),
  'site',       (select site from cfg),
  'grain',      (select grain from cfg),
  'totalLeads', (select n from total),
  'sources', jsonb_build_object(
    'bySite',     (select v from rank_site),
    'byChannel',  (select v from rank_channel),
    'byCampaign', (select v from rank_campaign)),
  'overTime',       (select v from over_time),
  'captureSurface', (select v from capture_surface),
  'inboundFeed',    (select v from inbound_feed),
  'byType',         (select v from by_type),
  'byCity',         (select v from by_city),
  'campaigns',      (select v from campaign_perf),
  'recent',         (select v from recent),
  'health', jsonb_build_object('windowDays',(select days from cfg),'sites',(select v from health)),
  'counts', jsonb_build_object(
    'leads',   (select n from total),
    'contacts',(select count(*) from public.crm_clients),
    'imports', (select count(*) from public.email_lead_imports e, cfg where e.created_at >= cfg.since))
);
$function$;
