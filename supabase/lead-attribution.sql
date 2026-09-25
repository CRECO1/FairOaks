-- Lead attribution — carry "what brought this lead" all the way into the CRM.
--
-- Before this, fairoaksrealtygroup.com leads arrived with no acquisition
-- signal at all: 0 of 28 rows in public.leads had a utm, referrer or landing
-- page, and crm_clients had nowhere to put one even if we'd had it. GA4 can
-- report sessions by channel, but it cannot tell us that *this named contact*
-- came from *that campaign* — that has to be stored next to the record.
--
-- public.leads already carries the seven utm/referrer/landing_page columns
-- (they were added and never populated), so this only extends the richer
-- context and mirrors the whole set onto crm_clients, which is the table the
-- Lead Attribution dashboard actually reads.
--
-- Safe to re-run: every statement is IF NOT EXISTS.

-- ── public.leads: the extra context the server can now derive ───────────────
alter table public.leads add column if not exists page_path   text;
alter table public.leads add column if not exists page_url    text;
alter table public.leads add column if not exists page_title  text;
alter table public.leads add column if not exists surface     text;
alter table public.leads add column if not exists geo         text;
alter table public.leads add column if not exists device      text;
alter table public.leads add column if not exists channel     text;

-- ── public.crm_clients: the full attribution set ────────────────────────────
-- crm_clients is the contact book the dashboard charts. A lead that becomes a
-- client must not lose how it was acquired.
alter table public.crm_clients add column if not exists utm_source   text;
alter table public.crm_clients add column if not exists utm_medium   text;
alter table public.crm_clients add column if not exists utm_campaign text;
alter table public.crm_clients add column if not exists utm_term     text;
alter table public.crm_clients add column if not exists utm_content  text;
alter table public.crm_clients add column if not exists referrer     text;
alter table public.crm_clients add column if not exists landing_page text;
alter table public.crm_clients add column if not exists page_path    text;
alter table public.crm_clients add column if not exists page_title   text;
alter table public.crm_clients add column if not exists surface      text;
alter table public.crm_clients add column if not exists geo          text;
alter table public.crm_clients add column if not exists device       text;
alter table public.crm_clients add column if not exists channel      text;
-- Which site produced the lead. Existing rows are left null rather than
-- guessed at — the dashboard's health meter counts nulls honestly.
alter table public.crm_clients add column if not exists lead_site    text;

-- ── public.email_lead_imports: channel on the inbound feed ──────────────────
alter table public.email_lead_imports add column if not exists channel   text;
alter table public.email_lead_imports add column if not exists lead_site text;

-- ── Indexes for the dashboard's group-bys ───────────────────────────────────
-- The attribution panels group by channel and by site over a date range, and
-- crm_clients is ~3k rows and growing. Partial indexes keep them small: the
-- vast majority of existing rows are imported prospect lists with no channel.
create index if not exists crm_clients_channel_idx
  on public.crm_clients (channel)
  where channel is not null;

create index if not exists crm_clients_lead_site_created_idx
  on public.crm_clients (lead_site, created_at desc)
  where lead_site is not null;

create index if not exists crm_clients_created_at_idx
  on public.crm_clients (created_at desc);

create index if not exists email_lead_imports_source_created_idx
  on public.email_lead_imports (source, created_at desc);

create index if not exists leads_channel_created_idx
  on public.leads (channel, created_at desc)
  where channel is not null;
