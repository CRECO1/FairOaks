-- Tracking v2 — visitor identity, click ids, environment, behaviour events, email-click identification.
-- Additive + idempotent. Run with the service role / postgres.

-- 1) Pageview log: who (anonymous visitor), which visit, ad click ids, environment.
alter table public.site_pageviews add column if not exists visitor_id text;
alter table public.site_pageviews add column if not exists visit_n    integer;
alter table public.site_pageviews add column if not exists click_ids  jsonb;
alter table public.site_pageviews add column if not exists browser    text;
alter table public.site_pageviews add column if not exists os         text;
alter table public.site_pageviews add column if not exists env        jsonb;
create index if not exists site_pageviews_visitor_idx on public.site_pageviews (visitor_id, created_at desc);

-- 2) Behaviour events (phone/email taps, CTA clicks, downloads, scroll, engaged time, form events, errors…).
create table if not exists public.site_events (
  id          bigint generated always as identity primary key,
  site        text not null,
  visitor_id  text,
  session_id  text,
  type        text not null,
  label       text,
  value       numeric,
  path        text,
  meta        jsonb,
  device      text,
  created_at  timestamptz not null default now()
);
create index if not exists site_events_created_idx      on public.site_events (created_at desc);
create index if not exists site_events_visitor_idx      on public.site_events (visitor_id, created_at desc);
create index if not exists site_events_site_type_idx    on public.site_events (site, type, created_at desc);
alter table public.site_events enable row level security;   -- service-role only, like site_pageviews

-- 3) A visitor id → a known contact (set when someone arrives via a signed ctk link in OUR campaign email,
--    or when they submit a lead form). Lets the CRM show a contact's website activity.
create table if not exists public.site_visitor_links (
  visitor_id text primary key,
  client_id  uuid not null references public.crm_clients(id) on delete cascade,
  source     text not null default 'email_link',   -- email_link | lead_form
  linked_at  timestamptz not null default now()
);
create index if not exists site_visitor_links_client_idx on public.site_visitor_links (client_id);
alter table public.site_visitor_links enable row level security;

-- 4) Lead / contact rows carry the whole visitor story.
alter table public.leads       add column if not exists visitor_id  text;
alter table public.leads       add column if not exists visit_count integer;
alter table public.leads       add column if not exists first_touch jsonb;
alter table public.leads       add column if not exists click_ids   jsonb;
alter table public.leads       add column if not exists env         jsonb;
alter table public.crm_clients add column if not exists visitor_id  text;
alter table public.crm_clients add column if not exists visit_count integer;
alter table public.crm_clients add column if not exists first_touch jsonb;
alter table public.crm_clients add column if not exists click_ids   jsonb;
alter table public.crm_clients add column if not exists env         jsonb;
create index if not exists crm_clients_visitor_idx on public.crm_clients (visitor_id) where visitor_id is not null;
