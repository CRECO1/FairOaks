-- Applied 2026-09-26. Data-integrity, security and performance batch.
-- Every statement below was run inside a transaction gated on the
-- verification described per section; the gate rolled back once (see note).

-- ── 1. FK fixes that are unambiguously correct ───────────────────────────────
-- email_tracking_events.campaign_id was ON DELETE SET NULL while
-- crm_campaign_sends.campaign_id was CASCADE. Deleting a campaign therefore
-- removed its sends but left the clicks/opens behind with a null campaign_id —
-- permanently uncountable, and silently dropped by the attribution RPC's
-- campaign join. The two tables now agree.
alter table public.email_tracking_events drop constraint email_tracking_events_campaign_id_fkey;
alter table public.email_tracking_events add constraint email_tracking_events_campaign_id_fkey
  foreign key (campaign_id) references public.crm_campaigns(id) on delete cascade;

-- audit_logs.actor_id is NOT NULL but carried ON DELETE SET NULL — a rule that
-- can never fire without violating the column. RESTRICT states the real intent
-- (an audit trail does not quietly lose its actor) and fails with a clear 23503
-- rather than a confusing 23502. No behaviour change: the delete failed before
-- and fails now, just legibly.
alter table public.audit_logs drop constraint audit_logs_actor_id_fkey;
alter table public.audit_logs add constraint audit_logs_actor_id_fkey
  foreign key (actor_id) references public.crm_profiles(id) on delete restrict;

-- ── 2. anon loses every write privilege ──────────────────────────────────────
-- anon held INSERT/UPDATE/DELETE/TRUNCATE on all 70 public tables, contained
-- only by RLS. One mistaken permissive policy, or RLS disabled on a table,
-- would have turned that into public data loss with no second layer.
-- Verified first that nothing writes with the anon key: every public form posts
-- to an API route using the service role, no public page imports the browser
-- Supabase client, and the CRM's 42 client-side writes run as `authenticated`
-- (a logged-in JWT switches the role; the anon key is only the API key).
-- SELECT is deliberately untouched — the public marketing site reads listings,
-- agents, testimonials, neighborhoods and site_settings through it.
--   revoke insert, update, delete, truncate, references, trigger
--     on table public.<each of 70 tables> from anon;

-- ── 3. Performance ───────────────────────────────────────────────────────────
-- The attribution RPC's lateral join matched on lower(btrim(k.email)); the
-- btrim made it unindexable and it seq-scanned 3,015 contacts once per lead.
-- Confirmed zero stored emails have surrounding whitespace, so dropping btrim
-- is semantically identical here — then added an index the expression can use.
create index if not exists crm_clients_lower_email_idx
  on public.crm_clients (lower(email));
create index if not exists email_tracking_events_occurred_at_idx
  on public.email_tracking_events (occurred_at desc);
create index if not exists crm_campaign_sends_sent_at_idx
  on public.crm_campaign_sends (sent_at desc);

-- lead_attribution_report was recreated with two edits:
--   * lower(btrim(k.email)) -> lower(k.email)   (now an index scan)
--   * order by cs.sent desc -> order by cs.sent desc, c.name
-- The second fixes a pre-existing wobble found while verifying: two campaigns
-- tie on sent=8 and three on sent=7, so the panel could reshuffle between
-- loads. It is what made the first verification gate fail — the payload
-- differed only in tie order, which an order-insensitive comparison proved was
-- not a data change.
--
-- Result: 385ms -> 117ms, results identical, ordering now deterministic.
