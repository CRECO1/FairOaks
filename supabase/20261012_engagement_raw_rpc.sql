-- One round trip for everything computeEngagement() reads (lib/campaign-engagement.ts).
-- It used to be ~15 sequential/paged PostgREST reads; the scoring logic stays in
-- TypeScript, this only returns the raw rows.
--
-- Returns jsonb { sends, clicks, reports, phones, calls, acts1, acts2, tasks } for the
-- given campaigns. phones/reports/acts/tasks are for every recipient (the TS side keeps
-- only the people who turned out to be engaged); calls and activities start at the
-- earliest send. Server-side use only: execute is revoked from anon/authenticated.
create or replace function crm_engagement_raw(p_campaign_ids uuid[], p_with_reports boolean default true)
returns jsonb
language sql
stable
as $$
  with s as (
    select campaign_id, client_id, sent_at
    from crm_campaign_sends
    where campaign_id = any(p_campaign_ids) and status = 'sent' and type = 'email'
  ),
  rcp as (select distinct client_id from s where client_id is not null),
  since as (select min(sent_at) as t from s where client_id is not null)
  select jsonb_build_object(
    'sends', coalesce((select jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'client_id', client_id, 'sent_at', sent_at) order by sent_at) from s), '[]'::jsonb),
    'clicks', coalesce((
      select jsonb_agg(jsonb_build_object('campaign_id', campaign_id, 'client_id', client_id, 'url', url, 'occurred_at', occurred_at, 'user_agent', user_agent) order by occurred_at)
      from email_tracking_events where campaign_id = any(p_campaign_ids) and event_type = 'click'), '[]'::jsonb),
    'reports', case when p_with_reports then coalesce((
      select jsonb_agg(jsonb_build_object('client_id', client_id, 'first_viewed_at', first_viewed_at, 'last_viewed_at', last_viewed_at, 'view_count', view_count, 'bov_requested_at', bov_requested_at))
      from crm_owner_reports where client_id in (select client_id from rcp) and first_viewed_at is not null), '[]'::jsonb) else '[]'::jsonb end,
    'phones', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'phone', phone, 'cell_phone', cell_phone))
      from crm_clients where id in (select client_id from rcp)), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object('direction', direction, 'from_number', from_number, 'to_number', to_number, 'contact_id', contact_id, 'started_at', started_at) order by started_at)
      from crm_call_log where started_at >= (select t from since)), '[]'::jsonb),
    'acts1', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', client_id, 'type', type, 'created_at', created_at))
      from crm_client_activities
      where client_id in (select client_id from rcp) and type in ('call', 'email', 'note', 'meeting') and created_at >= (select t from since)), '[]'::jsonb),
    'acts2', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', client_id, 'type', type, 'created_at', created_at))
      from crm_activity
      where client_id in (select client_id from rcp) and type in ('call', 'email', 'note', 'meeting') and created_at >= (select t from since)), '[]'::jsonb),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object('client_id', client_id, 'type', type, 'status', status, 'completed_at', completed_at, 'created_at', created_at))
      from crm_tasks where client_id in (select client_id from rcp) and type in ('call', 'follow_up')), '[]'::jsonb)
  );
$$;

revoke all on function crm_engagement_raw(uuid[], boolean) from public, anon, authenticated;
grant execute on function crm_engagement_raw(uuid[], boolean) to service_role;
