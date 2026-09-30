-- Record campaign bounces and spam complaints next to opens and clicks.
--
-- The Resend webhook already receives email.bounced / email.complained for campaign
-- sends, but email_tracking_events only allowed 'open' and 'click', so they were
-- dropped and the CRM had no idea a list was bouncing (the 2026-09-29 AutoBrite Pad
-- broker blast bounced 28 of 56 and nothing in the app noticed). The campaign
-- volume ramp (src/lib/email-volume.ts) reads these rows as its health signal.
--
-- Every existing reader filters on event_type = 'open' / 'click', so the new values
-- don't change any open or click metric.

alter table public.email_tracking_events
  drop constraint if exists email_tracking_events_event_type_check;
alter table public.email_tracking_events
  add constraint email_tracking_events_event_type_check
  check (event_type in ('open', 'click', 'bounce', 'complaint'));

-- The ramp's health check: bounces/complaints in the trailing window.
create index if not exists email_tracking_events_type_occurred_idx
  on public.email_tracking_events (event_type, occurred_at desc);
