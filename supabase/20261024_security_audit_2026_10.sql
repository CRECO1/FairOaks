-- Security audit 2026-10 — database changes. Additive/idempotent. NOT applied automatically: review, then run once
-- (Supabase SQL editor, or the session pooler as in memory/supabase-sql-access). Apply BEFORE deploying the code that
-- reads the new columns; the code also degrades gracefully if it is applied late (see listing-alerts routes).
--
--   1. listing_alerts: double opt-in, one row per address, no more anonymous direct inserts   (audit H7)
--   2. anon least-privilege: no INSERT/UPDATE/DELETE on tables only the service role writes; nobody gets TRUNCATE   (Low)
--   3. plaza-resumes: the anonymous upload policy now only accepts the object-name shape the apply RPC accepts   (M11)

-- ── 1. listing_alerts ──────────────────────────────────────────────────────────────────────────────────────────
alter table public.listing_alerts add column if not exists confirmed_at  timestamptz;
alter table public.listing_alerts add column if not exists confirm_token uuid not null default gen_random_uuid();

-- Subscriptions that existed before double opt-in are kept (as of 2026-10-24 there was exactly one, from 2026-09-23).
update public.listing_alerts set confirmed_at = created_at where confirmed_at is null;

-- One row per address. Keep the newest if any duplicates slipped in.
delete from public.listing_alerts a using public.listing_alerts b
  where lower(a.email) = lower(b.email) and a.created_at < b.created_at;
create unique index if not exists listing_alerts_email_uniq on public.listing_alerts (lower(email));
create unique index if not exists listing_alerts_confirm_token_uniq on public.listing_alerts (confirm_token);

-- The site's /api/listing-alerts route inserts with the service role. The anon INSERT policy (WITH CHECK true) only
-- let anyone with the public anon key bypass that route's rate limit and bot guard and enqueue unlimited recipients.
drop policy if exists listing_alerts_anon_insert on public.listing_alerts;
revoke all on public.listing_alerts from anon, authenticated;

-- ── 2. least privilege for anon ────────────────────────────────────────────────────────────────────────────────
-- Supabase grants every table to anon/authenticated by default. RLS already denies these, but TRUNCATE is not subject
-- to RLS, so keep the grants to what the policies allow. (SELECT is kept: plaza_* have public "published" read policies.)
do $$
declare t text;
begin
  foreach t in array array[
    'crm_call_sla_alerts','crm_copilot_chats','crm_dead_emails','crm_engagement_cache','crm_gmail_scan_cache',
    'plaza_job_applications','plaza_jobs','plaza_listing_invites','plaza_listings','plaza_posts','plaza_vendors',
    'site_bot_hits','site_contact_alerts','site_events','site_pageviews','site_visitor_links'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon', t);
    end if;
  end loop;
end $$;

-- TRUNCATE / REFERENCES / TRIGGER are never needed through the API for any table.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.tablename);
  end loop;
end $$;

-- ── 3. plaza-resumes anonymous upload ──────────────────────────────────────────────────────────────────────────
-- plaza_job_apply() only accepts a resume_path shaped  <uuid>/<safe filename>  (see its regex). Accept nothing else
-- from anonymous uploaders, so the bucket can't be used as free arbitrary-name storage.
drop policy if exists plaza_resumes_anon_insert on storage.objects;
create policy plaza_resumes_anon_insert on storage.objects
  for insert to anon
  with check (bucket_id = 'plaza-resumes' and name ~ '^[a-f0-9-]{36}/[A-Za-z0-9._-]{1,100}$');
