-- Throttle + audit for "known contact is on the website" alerts (lib/known-contact-alert.ts).
-- One row per alert kind sent; the sender looks back a window per (client, kind) so a contact tapping the phone
-- number three times, or browsing for an hour, buzzes the owner once. Additive + idempotent.
create table if not exists public.site_contact_alerts (
  id         bigint generated always as identity primary key,
  client_id  uuid not null references public.crm_clients(id) on delete cascade,
  kind       text not null,                 -- phone_tap | email_tap | text_tap | download | lead_form_started | engaged_visit
  sent_to    text[] not null default '{}',
  detail     text,
  created_at timestamptz not null default now()
);
create index if not exists site_contact_alerts_client_kind_idx on public.site_contact_alerts (client_id, kind, created_at desc);
alter table public.site_contact_alerts enable row level security;   -- service-role only
