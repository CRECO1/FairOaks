-- Task walls (2026-11-12): the account owner can hide one person's tasks from another person.
--   First wall, on Zack's word ("hide Robert's tasks from Brian"): Robert's tasks are hidden from Brian.
--
-- A task BELONGS to a person when they own it (agent_id) or are assigned to it (assigned_to). It is hidden from `hidden_from` unless it ALSO
-- belongs to them (a task owned by Robert but assigned to Brian is Brian's). created_by is ignored on purpose: a task Brian creates for Robert is
-- Robert's. The account owner (super_admin) is never walled, whatever the table says.
--
--   crm_task_walls       (hidden_owner, hidden_from)   server-only: RLS on, no policies, no browser grants — the people it hides things from can't read it
--   crm_task_wall_ok()   "may the signed-in user see a task owned by / assigned to these two?"  (SECURITY DEFINER so it can read the table)
--   task_wall_hide       a RESTRICTIVE select policy on crm_tasks, on top of the existing ones (MFA, lead hold, restricted deals, scoped select)
--
-- Reads only: a hidden task can't be selected, and so (Postgres applies the select policy to the rows an UPDATE / DELETE has to find) it can't be
-- changed or deleted from the browser either. Creating a task for someone is not blocked; only reading it back afterwards is.
-- The server routes that read tasks with the service key bypass RLS, so they apply the same rule in code: src/lib/task-walls.ts.
--
-- Add / remove a wall later (SQL editor or the pooler, as owner):
--   insert into public.crm_task_walls (hidden_owner, hidden_from, note) values ('<owner profile id>', '<who must not see them>', 'why');
--   delete from public.crm_task_walls where hidden_owner = '<owner profile id>' and hidden_from = '<who>';
--
-- Rollback (nothing else depends on it):
--   drop policy if exists task_wall_hide on public.crm_tasks;
--   drop function if exists public.crm_task_wall_ok(uuid, uuid);
--   drop table if exists public.crm_task_walls;
-- Idempotent; safe to re-run.

create table if not exists public.crm_task_walls (
  hidden_owner uuid not null references public.crm_profiles(id) on delete cascade,
  hidden_from  uuid not null references public.crm_profiles(id) on delete cascade,
  note         text,
  created_at   timestamptz not null default now(),
  primary key (hidden_owner, hidden_from),
  constraint crm_task_walls_not_self check (hidden_owner <> hidden_from)
);
alter table public.crm_task_walls enable row level security;
revoke all on public.crm_task_walls from anon, authenticated;
comment on table public.crm_task_walls is 'Whose tasks are hidden from whom (owner-managed, server-only). See supabase/task-walls-2026-11.sql.';

create or replace function public.crm_task_wall_ok(p_agent uuid, p_assigned uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.crm_is_super_admin()
      or not exists (
        select 1 from public.crm_task_walls w
        where w.hidden_from = auth.uid()
          and (p_agent = w.hidden_owner or p_assigned = w.hidden_owner)
          and p_agent    is distinct from auth.uid()
          and p_assigned is distinct from auth.uid()
      );
$$;
revoke all on function public.crm_task_wall_ok(uuid, uuid) from public, anon;
grant execute on function public.crm_task_wall_ok(uuid, uuid) to authenticated, service_role;

drop policy if exists task_wall_hide on public.crm_tasks;
create policy task_wall_hide on public.crm_tasks as restrictive for select to authenticated
  using (public.crm_task_wall_ok(agent_id, assigned_to));

-- The first wall: Robert's tasks are hidden from Brian.
insert into public.crm_task_walls (hidden_owner, hidden_from, note)
select r.id, b.id, 'Zack, 2026-11-12: Robert''s tasks are private from Brian'
from public.crm_profiles r, public.crm_profiles b
where lower(r.email) = 'robert@crecotx.com' and lower(b.email) = 'brian@crecotx.com'
on conflict do nothing;
