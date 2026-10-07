-- Broker-blast bounce protection (2026-10-07 audit: 13% bounce rate over 30 days, AutoBrite Pad 52%).
-- Additive + idempotent.

-- 1) Per-campaign hold for risky, never-proven addresses (guessed-style or at a domain that has bounced).
alter table public.crm_campaigns add column if not exists hold_risky_addresses boolean not null default false;
update public.crm_campaigns set hold_risky_addresses = true where name ilike '%broker blast%';

-- 2) Keep WHY a message bounced (Resend gives type / subType / message) — before this we only knew "it bounced".
alter table public.email_tracking_events add column if not exists detail text;
