-- Property tagging round 6.
--  1) crm_job_runs: a small log of what the scheduled tagging jobs did (morning inquiry alert, daily outreach-reply conversion), for the admin panel.
--  2) crm_tag_review_skips.source also accepts 'callsummary' (old phone-bot / voicemail summaries reviewed for property tags).
begin;
create table if not exists public.crm_job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  ran_at timestamptz not null default now(),
  ok boolean not null default true,
  summary text,
  detail jsonb
);
create index if not exists crm_job_runs_job_ran_at_idx on public.crm_job_runs (job, ran_at desc);
alter table public.crm_job_runs enable row level security;

alter table public.crm_tag_review_skips drop constraint if exists crm_tag_review_skips_source_check;
alter table public.crm_tag_review_skips add constraint crm_tag_review_skips_source_check check (source in ('contact', 'activity', 'call', 'callsummary'));

do $$ begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='crm_job_runs') then raise exception 'crm_job_runs missing'; end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_tag_review_skips_source_check') then raise exception 'skips source check missing'; end if;
end $$;
commit;
