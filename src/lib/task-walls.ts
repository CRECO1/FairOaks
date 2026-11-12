import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Task walls — "Robert's tasks are not Brian's to see".
 *
 * crm_task_walls (hidden_owner, hidden_from) is the account owner's list of whose tasks may NOT be seen by whom (supabase/task-walls-2026-11.sql).
 * A task BELONGS to a person when they own it (agent_id) or are assigned to it (assigned_to). It is hidden from someone walled off from its
 * owner unless it ALSO belongs to them. created_by is ignored. The account owner (super_admin) is never walled.
 *
 * The database applies the same rule to direct reads (policy task_wall_hide on crm_tasks → crm_task_wall_ok). This file is for the server routes
 * that read with the service key and so bypass RLS: filter what they return through dropWalledTasks / taskWalled. Keep the two in step —
 * scripts/task-walls-check.ts pins this side, and the rolled-back database check compares it with the policy row by row.
 */

type Who = { userId: string; role: string | null };
export type TaskLike = { agent_id?: string | null; assigned_to?: string | null };

const TTL_MS = 30_000;           // walls change by hand-run SQL, so a short per-instance cache is plenty
const NO_TABLE_TTL_MS = 5_000;   // …and "the table isn't there yet" is re-checked quickly, so applying the SQL takes effect within seconds
const cache = new Map<string, { at: number; ttl: number; owners: Set<string> }>();
// How Postgres / PostgREST say "that table doesn't exist (yet)", depending on version
const NO_TABLE = /PGRST205|42P01|schema cache|does not exist/i;

/**
 * The people whose tasks are hidden from `who`. Empty for the account owner, and when the wall table doesn't exist yet (the code can go out before
 * the SQL). Any OTHER failure to read the list throws: a wall that can't be read must never quietly turn into "no wall" — an error beats a leak.
 */
export async function walledTaskOwners(db: SupabaseClient, who: Who): Promise<Set<string>> {
  if (who.role === 'super_admin') return new Set();
  const hit = cache.get(who.userId);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.owners;
  const { data, error } = await db.from('crm_task_walls').select('hidden_owner').eq('hidden_from', who.userId);
  if (error) {
    if (!NO_TABLE.test(`${(error as { code?: string }).code ?? ''} ${error.message ?? ''}`)) throw new Error(`task walls could not be read: ${error.message}`);
    cache.set(who.userId, { at: Date.now(), ttl: NO_TABLE_TTL_MS, owners: new Set() });
    return new Set();
  }
  const owners = new Set((data ?? []).map(r => String((r as { hidden_owner: string }).hidden_owner)));
  cache.set(who.userId, { at: Date.now(), ttl: TTL_MS, owners });
  return owners;
}

/** True when this task is one of a walled-off person's and is not also the viewer's own. */
export function taskWalled(t: TaskLike, owners: Set<string>, me: string): boolean {
  if (!owners.size) return false;
  const a = t.agent_id ?? null;
  const s = t.assigned_to ?? null;
  const theirs = (a !== null && owners.has(a)) || (s !== null && owners.has(s));
  const mine = a === me || s === me;
  return theirs && !mine;
}

/** The rows the viewer may see: everything except tasks of someone walled off from them. */
export async function dropWalledTasks<T extends TaskLike>(db: SupabaseClient, who: Who, rows: T[]): Promise<T[]> {
  const owners = await walledTaskOwners(db, who);
  return owners.size ? rows.filter(t => !taskWalled(t, owners, who.userId)) : rows;
}
