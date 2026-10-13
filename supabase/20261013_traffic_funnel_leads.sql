-- Inbound leads with the deals that came from them, for the "Traffic → dollars" funnel on the
-- Lead Attribution page (/api/crm/traffic-funnel). One row per lead, deals nested.
-- Uses the same inbound / test / site rules as lead_attribution_report so the lead counts agree.
-- Server-side only: execute is revoked from anon/authenticated (same stance as the report RPC).
create or replace function traffic_funnel_leads(p_since timestamptz, p_site text default null)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'created_at', c.created_at,
      'site', public.lead_site_of(c.lead_site, c.lead_source),
      'channel', nullif(btrim(coalesce(c.channel, '')), ''),
      'referrer', c.referrer,
      'utm_campaign', c.utm_campaign,
      'click_ids', c.click_ids,
      'visitor_id', c.visitor_id,
      'lead_source', c.lead_source,
      'business_unit', c.business_unit,
      'deals', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', d.id, 'stage', d.stage, 'value', d.value,
                 'earned_commission', d.earned_commission, 'created_at', d.created_at))
        from crm_deals d where d.client_id = c.id), '[]'::jsonb)
    ) order by c.created_at desc), '[]'::jsonb)
  from crm_clients c
  where c.created_at >= p_since
    and public.crm_lead_is_inbound(c.lead_source, c.lead_site, c.channel, c.utm_campaign, c.referrer, c.landing_page)
    and not public.lead_is_test(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''), c.email)
    and (p_site is null or public.lead_site_of(c.lead_site, c.lead_source) = p_site);
$$;

revoke all on function traffic_funnel_leads(timestamptz, text) from public, anon, authenticated;
grant execute on function traffic_funnel_leads(timestamptz, text) to service_role;
