import type { SupabaseClient } from '@supabase/supabase-js';

/** One line in the job log (table crm_job_runs) for the admin "Tagging jobs" panel. Best effort: never throws, and does nothing before the table exists. */
export async function recordJobRun(db: SupabaseClient, job: string, ok: boolean, summary: string, detail?: Record<string, unknown>): Promise<void> {
  try { await db.from('crm_job_runs').insert([{ job, ok, summary: summary.slice(0, 400), detail: detail ?? null }]); } catch { /* the log must never break a job */ }
}
