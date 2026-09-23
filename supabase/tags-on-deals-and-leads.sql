-- ============================================================================
-- Tags on deals and web leads
--
-- Contacts have carried `tags text[]` since the beginning and the brokerage
-- uses them heavily (2,444 of 2,953 contacts tagged). Deals and inbound web
-- leads had no equivalent — deals only had `stage`, which is a pipeline
-- position, not a label you can segment on.
--
-- Mirrors crm_clients exactly: text[], defaulting to empty rather than NULL so
-- every read can treat it as an array, plus a GIN index for `tags && ...` and
-- `tags @> ...` containment lookups (the same access pattern the Property DB
-- already indexes this way).
--
-- Idempotent: safe to re-run.
-- ============================================================================

begin;

alter table public.crm_deals add column if not exists tags text[] default '{}'::text[];
alter table public.leads     add column if not exists tags text[] default '{}'::text[];

-- Existing rows predate the default, so they are NULL rather than '{}'.
update public.crm_deals set tags = '{}'::text[] where tags is null;
update public.leads     set tags = '{}'::text[] where tags is null;

create index if not exists idx_crm_deals_tags on public.crm_deals using gin (tags);
create index if not exists idx_leads_tags     on public.leads     using gin (tags);

commit;

-- ============================================================================
-- ROLLBACK
-- ============================================================================
-- begin;
-- drop index if exists public.idx_crm_deals_tags;
-- drop index if exists public.idx_leads_tags;
-- alter table public.crm_deals drop column if exists tags;
-- alter table public.leads     drop column if exists tags;
-- commit;
