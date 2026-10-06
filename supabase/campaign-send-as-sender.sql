-- Per-campaign opt-in: send FROM the campaign's sender agent ("Zachary A.
-- Stovall <zack@crecotx.com>") instead of the brand noreply address. Meant for
-- one-to-one style outreach (e.g. the Kendall "Win the Listing" BD email),
-- where a personal From earns more opens and replies. The agent address is
-- still forced onto the campaign brand's verified domain by the cron.
alter table public.crm_campaigns add column if not exists send_as_sender boolean not null default false;
