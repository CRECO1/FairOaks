import type { SupabaseClient } from '@supabase/supabase-js';

export type JobDef = {
  key: string; label: string; when: string;
  /** Scheduled jobs: the longest gap that is still normal between two runs. Event-driven jobs (a call summary saved) have none. */
  maxHours?: number;
  /** What counts as a "real" run, one that actually did something (not just "nothing to do today"). */
  real?: (detail: Record<string, unknown> | null) => boolean;
  realLabel: string;
};
const n = (d: Record<string, unknown> | null, k: string) => Number(d?.[k] ?? 0) > 0;

export const JOBS: JobDef[] = [
  { key: 'property-inquiry-digest', label: 'Morning inquiry alert', when: 'weekdays about 8–9 AM Central', maxHours: 80, real: d => n(d, 'sent'), realLabel: 'an alert reached a phone' },
  { key: 'targeted-replies', label: 'Outreach reply conversion', when: 'daily about 8:20–9:20 AM Central', maxHours: 36, real: d => n(d, 'converted'), realLabel: 'someone we reached out to was moved to asked' },
  { key: 'second-touch-drafts', label: 'Second-touch drafts', when: 'Mondays about 8:50–9:50 AM Central (drafts only, never sent)', maxHours: 204, real: d => n(d, 'made'), realLabel: 'a second-touch draft was saved' },
  { key: 'owner-update-drafts', label: 'Weekly owner update drafts', when: 'Mondays about 8:40–9:40 AM Central (drafts only, never sent)', maxHours: 204, real: d => n(d, 'made'), realLabel: 'an owner update draft was saved' },
  { key: 'tagging-selfcheck', label: 'Nightly self-check', when: 'daily about 4:15–5:15 AM Central (tests the tagger on a sample, sends nothing)', maxHours: 36, realLabel: 'ran' },
  { key: 'call-auto-tag', label: 'Phone bot & voicemail tagging', when: 'each time a call summary is saved', real: () => true, realLabel: 'a real call summary was tagged to a property' },
];

export type JobStatus = 'ok' | 'failed' | 'late' | 'never' | 'waiting';
export type JobHealth = JobDef & { runs: { ran_at: string; ok: boolean; summary: string | null }[]; status: JobStatus; hoursSince: number | null; lastReal: { ran_at: string; summary: string | null } | null; note: string | null };

/** Status of every tagging job from the job log: did it run on schedule, did it fail, has it ever done something for real. Read-only. */
export async function jobHealth(db: SupabaseClient, now = Date.now()): Promise<JobHealth[]> {
  const { data: oldest } = await db.from('crm_job_runs').select('ran_at').order('ran_at', { ascending: true }).limit(1);
  const logStart = oldest?.[0]?.ran_at ? Date.parse(String(oldest[0].ran_at)) : null;
  // First day a second-touch draft can exist: 30 days after the earliest outreach mark that has not been drafted yet.
  const { data: tg } = await db.from('crm_clients').select('targeted_at').not('targeted_listing_ids', 'eq', '{}').is('second_touch_drafted_at', null).not('targeted_at', 'is', null).order('targeted_at', { ascending: true }).limit(1);
  const firstDue = tg?.[0]?.targeted_at ? new Date(Date.parse(String(tg[0].targeted_at)) + 30 * 86_400_000) : null;
  const out: JobHealth[] = [];
  for (const j of JOBS) {
    const { data } = await db.from('crm_job_runs').select('ran_at, ok, summary, detail').eq('job', j.key).order('ran_at', { ascending: false }).limit(40);
    const rows = data ?? [];
    const last = rows[0];
    const hoursSince = last ? Math.round(((now - Date.parse(String(last.ran_at))) / 3_600_000) * 10) / 10 : null;
    const realRow = j.real ? rows.find(r => r.ok && j.real!((r.detail as Record<string, unknown> | null) ?? null)) : undefined;
    let status: JobStatus;
    if (!last) status = j.maxHours ? ((logStart && now - logStart > j.maxHours * 2 * 3_600_000) ? 'late' : 'never') : 'waiting';
    else if (!last.ok) status = 'failed';
    else if (j.maxHours && hoursSince !== null && hoursSince > j.maxHours) status = 'late';
    else status = 'ok';
    const note = j.key === 'second-touch-drafts' && firstDue ? `First drafts can be made on ${firstDue.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })} (30 days after the first outreach mark).` : null;
    out.push({ ...j, runs: rows.slice(0, 5).map(r => ({ ran_at: String(r.ran_at), ok: !!r.ok, summary: (r.summary as string | null) ?? null })), status, hoursSince, lastReal: realRow ? { ran_at: String(realRow.ran_at), summary: (realRow.summary as string | null) ?? null } : null, note });
  }
  return out;
}

/** Scheduled jobs that have gone quiet (or never ran although the log is old enough that they should have): what the nightly self-check turns red for. */
export async function silentJobs(db: SupabaseClient): Promise<string[]> {
  const h = await jobHealth(db);
  return h.filter(j => j.maxHours && j.key !== 'tagging-selfcheck' && j.status === 'late').map(j => j.hoursSince === null ? `${j.label} has never run` : `${j.label} last ran ${Math.round((j.hoursSince ?? 0) / 24 * 10) / 10} days ago`);
}
