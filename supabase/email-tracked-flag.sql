-- Sent page + honest open stats (2026-10-28). crm_deal_emails.tracking_id defaults to gen_random_uuid(), so
-- Gmail-synced sends have one too and every "opened %" counted mail that never carried a pixel. Only
-- /api/gmail/send sets tracked = true from now on; anything already opened obviously had one. Applied 2026-10-28.
alter table public.crm_deal_emails add column if not exists tracked boolean not null default false;
update public.crm_deal_emails set tracked = true where opened_at is not null and not tracked;
