import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

const JOBS: { key: string; label: string; when: string }[] = [
  { key: 'property-inquiry-digest', label: 'Morning inquiry alert', when: 'weekdays about 9 AM Central' },
  { key: 'targeted-replies', label: 'Outreach reply conversion', when: 'daily about 9:20 AM Central' },
  { key: 'owner-update-drafts', label: 'Weekly owner update drafts', when: 'Mondays about 9:40 AM Central (drafts only, never sent)' },
  { key: 'call-auto-tag', label: 'Phone bot & voicemail tagging', when: 'each time a call summary is saved' },
];

/** GET /api/crm/job-runs — admins: the last runs of the scheduled tagging jobs (what each did, or the error), newest first. Empty until the log table exists. */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const out = [];
  for (const j of JOBS) {
    const { data } = await db.from('crm_job_runs').select('ran_at, ok, summary').eq('job', j.key).order('ran_at', { ascending: false }).limit(5);
    out.push({ ...j, runs: data ?? [] });
  }
  return NextResponse.json({ jobs: out });
}
