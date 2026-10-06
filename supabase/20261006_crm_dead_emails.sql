-- Dead-email list: addresses known not to exist (hard bounces), kept so no import,
-- crawl, lead form or broker-email ingest can ever put them back into a send.
--
-- How it holds:
--   * crm_dead_emails is the list (one lowercased address per row).
--   * A BEFORE INSERT / UPDATE OF email trigger on crm_clients checks every contact
--     write, whatever the path (UI, API routes, CSV import, service-role scripts):
--     a dead address is saved but suppressed (unsubscribed_at) and tagged 'Dead Email'.
--     The contact itself is kept — a phone number or company may still be good.
--   * Adding an address to the list suppresses every existing contact that has it.
--   * A hard bounce adds itself: the Resend webhook records the bounce event and then
--     stamps unsubscribed_at on the contact; when that stamp lands on a contact with a
--     bounce event in the last day (webhooks can arrive late or be retried), the address goes on the list. (Complaints
--     and genuine unsubscribes have no bounce event, so they never land here.)

create table if not exists public.crm_dead_emails (
  email      text primary key check (email = lower(btrim(email))),
  reason     text not null default 'hard bounce',
  source     text,
  created_at timestamptz not null default now()
);
alter table public.crm_dead_emails enable row level security;
-- No policies: the app and scripts reach it through the service role or the
-- SECURITY DEFINER functions below, never directly from a browser session.

-- 1. Any contact write carrying a dead address is suppressed + tagged.
create or replace function public.crm_clients_dead_email_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and exists (
       select 1 from public.crm_dead_emails d where d.email = lower(btrim(new.email))) then
    new.unsubscribed_at := coalesce(new.unsubscribed_at, now());
    if not (coalesce(new.tags, '{}') @> array['Dead Email']) then
      new.tags := array_append(coalesce(new.tags, '{}'), 'Dead Email');
    end if;
  end if;
  return new;
end $$;

drop trigger if exists crm_clients_dead_email_guard on public.crm_clients;
create trigger crm_clients_dead_email_guard
  before insert or update of email on public.crm_clients
  for each row execute function public.crm_clients_dead_email_guard();

-- 2. Listing an address suppresses every contact that already has it, and pulls
--    them out of any queued campaign.
create or replace function public.crm_dead_emails_apply() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.crm_clients c
     set unsubscribed_at = coalesce(c.unsubscribed_at, now()),
         tags = case when coalesce(c.tags, '{}') @> array['Dead Email'] then c.tags
                     else array_append(coalesce(c.tags, '{}'), 'Dead Email') end
   where lower(btrim(c.email)) = new.email;
  update public.crm_campaign_enrollments e
     set active = false, next_send_at = null
    from public.crm_clients c
   where e.client_id = c.id and e.active and lower(btrim(c.email)) = new.email;
  return new;
end $$;

drop trigger if exists crm_dead_emails_apply on public.crm_dead_emails;
create trigger crm_dead_emails_apply
  after insert on public.crm_dead_emails
  for each row execute function public.crm_dead_emails_apply();

-- 3. A hard bounce lists itself (see header).
create or replace function public.crm_clients_learn_dead_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.unsubscribed_at is not null and old.unsubscribed_at is null
     and exists (select 1 from public.email_tracking_events t
                  where t.client_id = new.id and t.event_type = 'bounce'
                    and t.occurred_at > now() - interval '1 day') then
    insert into public.crm_dead_emails (email, reason, source)
    values (lower(btrim(new.email)), 'hard bounce', 'resend webhook')
    on conflict (email) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists crm_clients_learn_dead_email on public.crm_clients;
create trigger crm_clients_learn_dead_email
  after update of unsubscribed_at on public.crm_clients
  for each row execute function public.crm_clients_learn_dead_email();
