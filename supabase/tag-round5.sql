-- Property tagging round 5.
--  1) crm_clients.targeted_at: when a contact was last marked "targeted" (an outreach-list contact), so "no reply in 30 days" can be listed.
--     Existing targeted contacts (marked 2026-11-16) are stamped now.
--  2) crm_tag_review_skips: "Not it" answers on the Tag-old-notes review, shared by the whole team (they were per-device before).
-- Both are only read/written by the API with the service key; the skips table has RLS on and no policies (deny-all to the browser).
begin;
alter table public.crm_clients add column if not exists targeted_at timestamptz;
update public.crm_clients set targeted_at = now() where targeted_listing_ids <> '{}' and targeted_at is null;
create index if not exists crm_clients_targeted_at_idx on public.crm_clients (targeted_at) where targeted_listing_ids <> '{}';

create table if not exists public.crm_tag_review_skips (
  source text not null check (source in ('contact', 'activity', 'call')),
  row_id uuid not null,
  listing_id uuid not null,
  business_unit text,
  skipped_by uuid,
  skipped_at timestamptz not null default now(),
  primary key (source, row_id, listing_id)
);
alter table public.crm_tag_review_skips enable row level security;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='crm_clients' and column_name='targeted_at') then raise exception 'crm_clients.targeted_at missing'; end if;
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='crm_tag_review_skips') then raise exception 'crm_tag_review_skips missing'; end if;
end $$;
commit;
