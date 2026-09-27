-- weekly_lead_digest(days) — the Monday morning email, computed in Postgres.
--
-- Aggregation lives here rather than in the route for the same reason
-- lead_attribution_report does: PostgREST caps a .select() at 1000 rows
-- regardless of .limit(), so counting in JS silently under-reports once the
-- table grows. It has already bitten this codebase once.
--
-- Scope matches the attribution dashboard exactly, so the digest and the
-- dashboard can never disagree: inbound leads only (crm_lead_is_inbound keeps
-- the imported prospect lists out), test rows excluded via lead_is_test, and
-- public.leads UNIONed with the web-lead rows of crm_clients, de-duplicated
-- across the two tables by email.

create or replace function public.weekly_lead_digest(days int default 7)
returns jsonb
language sql
stable
as $$
with
cfg as (
  select greatest(coalesce(days, 7), 1)                                  as d,
         now() - make_interval(days => greatest(coalesce(days,7),1))     as since,
         now() - make_interval(days => greatest(coalesce(days,7),1) * 2) as prior_since
),

-- Every inbound lead from both tables, with the window it falls in.
raw as (
  select l.created_at,
         public.lead_site_of(l.lead_site, l.source) as site,
         nullif(btrim(coalesce(l.channel,'')),'')      as channel,
         nullif(btrim(coalesce(l.source,'')),'')       as source,
         nullif(btrim(coalesce(l.utm_campaign,'')),'') as campaign,
         coalesce(nullif(btrim(l.name),''),'')         as name,
         lower(nullif(btrim(l.email),''))              as email_key,
         (l.utm_campaign is null and l.channel is null
          and l.referrer is null and l.landing_page is null) as no_attribution,
         0 as src_rank
  from public.leads l
  where not public.lead_is_test(l.name, l.email)
  union all
  select k.created_at,
         public.lead_site_of(k.lead_site, k.lead_source),
         nullif(btrim(coalesce(k.channel,'')),''),
         nullif(btrim(coalesce(k.lead_source,'')),''),
         nullif(btrim(coalesce(k.utm_campaign,'')),''),
         coalesce(nullif(btrim(coalesce(k.first_name,'')||' '||coalesce(k.last_name,'')),''),''),
         lower(nullif(btrim(k.email),'')),
         (k.utm_campaign is null and k.channel is null
          and k.referrer is null and k.landing_page is null),
         1
  from public.crm_clients k
  where public.crm_lead_is_inbound(k.lead_source, k.lead_site, k.channel, k.utm_campaign, k.referrer, k.landing_page)
    and not public.lead_is_test(coalesce(k.first_name,'')||' '||coalesce(k.last_name,''), k.email)
),
-- Cross-table dedupe only; repeat submissions within one table are real.
deduped as (
  select r.* from raw r
  where r.src_rank = 0
     or r.email_key is null
     or not exists (select 1 from public.leads l where lower(nullif(btrim(l.email),'')) = r.email_key)
),
this_week  as (select d.* from deduped d, cfg where d.created_at >= cfg.since),
prior_week as (select d.* from deduped d, cfg where d.created_at >= cfg.prior_since and d.created_at < cfg.since),

grp as (
  select
    (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from
      (select coalesce(site,'Other') label, count(*) n from this_week group by 1 order by 2 desc) x) as by_site,
    (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from
      (select coalesce(channel,'Not recorded') label, count(*) n from this_week group by 1 order by 2 desc limit 8) x) as by_channel,
    (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from
      (select coalesce(source,'(unknown)') label, count(*) n from this_week group by 1 order by 2 desc limit 8) x) as by_source,
    (select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) from
      (select coalesce(campaign,'No campaign') label, count(*) n from this_week group by 1 order by 2 desc limit 8) x) as by_campaign
),

-- Campaign performance for anything that actually sent in the window.
--
-- Sends and tracking events are aggregated SEPARATELY and then joined. Doing
-- it in one query with a LEFT JOIN multiplies each send row by the number of
-- matching events, which inflated a 41-send campaign to 287. Verified against
-- a raw count before and after.
camp_sends as (
  select s.campaign_id,
         count(*)              as sent,
         count(s.opened_at)    as opens
  from public.crm_campaign_sends s, cfg
  where s.sent_at >= cfg.since
  group by s.campaign_id
),
camp_clicks as (
  select e.campaign_id,
         count(distinct e.client_id) as clickers
  from public.email_tracking_events e, cfg
  where e.event_type = 'click' and e.occurred_at >= cfg.since
  group by e.campaign_id
),
camp as (
  select coalesce(jsonb_agg(x order by x.sent desc), '[]'::jsonb) v from (
    select k.name,
           cs.sent,
           cs.opens,
           coalesce(cc.clickers, 0) as clicks
    from camp_sends cs
    join public.crm_campaigns k on k.id = cs.campaign_id
    left join camp_clicks cc on cc.campaign_id = cs.campaign_id
    where cs.sent > 0
    order by cs.sent desc, k.name limit 10) x
),

recent as (
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb) v from (
    select name, created_at, site, coalesce(channel,'—') channel,
           coalesce(campaign,'—') campaign, no_attribution
    from this_week where name <> '' order by created_at desc limit 15) x
)

select jsonb_build_object(
  'windowDays',     (select d from cfg),
  'since',          (select since from cfg),
  'total',          (select count(*) from this_week),
  'priorTotal',     (select count(*) from prior_week),
  'noAttribution',  (select count(*) from this_week where no_attribution),
  'topSource',      (select coalesce(source,'(unknown)') from this_week
                     group by source order by count(*) desc, 1 limit 1),
  'bySite',         (select by_site from grp),
  'byChannel',      (select by_channel from grp),
  'bySource',       (select by_source from grp),
  'byCampaign',     (select by_campaign from grp),
  'campaigns',      (select v from camp),
  'recent',         (select v from recent)
);
$$;

revoke all on function public.weekly_lead_digest(int) from public, anon, authenticated;
grant execute on function public.weekly_lead_digest(int) to service_role;
