-- Property performance (CRM property card + weekly owner report).
--  * crm_listings.web_paths: extra URL fragments that count as this property's web pages
--    (matched against "<host><path>", case-insensitive). Optional: pages are also matched on
--    slugs derived from the property's name/address, and on lead_keywords.
--  * property_inquiry_leads(): inbound leads in a window with their landing page, for matching
--    inquiries to a property. Names only (no email/phone). Server-side use: execute is revoked
--    from anon/authenticated, same stance as the other attribution RPCs.
alter table crm_listings add column if not exists web_paths text[];

create or replace function property_inquiry_leads(p_since timestamptz)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id,
      'created_at', c.created_at,
      'name', nullif(btrim(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, '')), ''),
      'lead_source', c.lead_source,
      'site', public.lead_site_of(c.lead_site, c.lead_source),
      'landing_page', c.landing_page,
      'page_path', c.page_path,
      'business_unit', c.business_unit
    ) order by c.created_at desc), '[]'::jsonb)
  from crm_clients c
  where c.created_at >= p_since
    and public.crm_lead_is_inbound(c.lead_source, c.lead_site, c.channel, c.utm_campaign, c.referrer, c.landing_page)
    and not public.lead_is_test(coalesce(c.first_name, '') || ' ' || coalesce(c.last_name, ''), c.email);
$$;

revoke all on function property_inquiry_leads(timestamptz) from public, anon, authenticated;
grant execute on function property_inquiry_leads(timestamptz) to service_role;
