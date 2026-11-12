-- Tasks: make "done" mean the same thing everywhere (2026-11-12).
--
-- Problem: a crm_tasks row can be finished two ways — status = 'done' (what the Tasks page writes) or a completed_at stamp (what the
-- Dashboard, the Call Queue, the 8 AM digest and the campaign call lists read). Nothing tied the two together, so a task finished in one
-- place stayed open in the others:
--   * tasks marked Done on the Tasks page had no completed_at, so they kept showing in the Call Queue and on the Dashboard
--     (46 such rows on 2026-11-12; 31 of them calls / follow-ups already due, most in Brian's queue);
--   * tasks finished in the Call Queue still said status 'open', so the Tasks page listed them as overdue and the morning digest
--     kept nagging about them (8 rows).
--   * the old Copilot "complete task" tool wrote status 'completed', a value the Tasks page does not know.
--
-- Fix: (1) repair the rows that disagree today — it only fills in what each row already says, nothing is deleted or reopened;
--      (2) a BEFORE INSERT/UPDATE trigger so every writer (app, crons, Copilot, SQL editor) keeps the two in step from now on.
--
-- Rules the trigger enforces:
--   status becomes done        -> completed_at is stamped (an existing stamp is kept)
--   status becomes open / in_progress -> completed_at is cleared (that is "reopen")
--   completed_at becomes set   -> status becomes done          (Call Queue / Dashboard "complete")
--   completed_at is cleared on a done task -> status becomes open  (Call Queue "undo")
--   status 'completed' is read as 'done'
-- Any other edit (title, due date, assignee…) leaves completion alone.
--
-- Safe to re-run. To switch the trigger off again (the repair itself is not reversed):
--   drop trigger if exists crm_tasks_sync_done_trg on public.crm_tasks;
--   drop function if exists public.crm_tasks_sync_done();

-- 1) repair: done on the Tasks page but never stamped -> stamp it with the moment it was last touched
update public.crm_tasks
   set completed_at = coalesce(updated_at, created_at, now())
 where status in ('done', 'completed') and completed_at is null;

-- 2) repair: stamped (finished in the Call Queue / Dashboard / by the Copilot) but status still says open -> done
update public.crm_tasks
   set status = 'done'
 where completed_at is not null and status is distinct from 'done';

-- 3) keep them in step from now on
create or replace function public.crm_tasks_sync_done() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.completed_at is not null then
      new.status := 'done';
    elsif new.status in ('done', 'completed') then
      new.status := 'done';
      new.completed_at := now();
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status in ('done', 'completed') then
      new.status := 'done';
      new.completed_at := coalesce(new.completed_at, now());
    else
      new.completed_at := null;                -- reopened
    end if;
  elsif new.completed_at is distinct from old.completed_at then
    if new.completed_at is not null then
      new.status := 'done';                    -- finished somewhere that only writes the stamp
    elsif new.status in ('done', 'completed') then
      new.status := 'open';                    -- stamp removed = undone
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists crm_tasks_sync_done_trg on public.crm_tasks;
create trigger crm_tasks_sync_done_trg
  before insert or update on public.crm_tasks
  for each row execute function public.crm_tasks_sync_done();
