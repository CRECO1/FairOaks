/**
 * GET /api/cron/backup-watch — daily, 8 AM Central. Checks the nightly CRM backup (crm_backup_runs,
 * written by the owner's Mac at 2:30 AM) and sends the OWNER a phone alert if the last run failed or
 * no run has reported in 30+ hours (Mac asleep/off, job stopped). Silent when all is well.
 * Super admins only; ignores per-device categories because a missed backup should always reach the owner.
 * Secured with CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendPushToProfiles, superAdminIds } from '@/lib/push';

const STALE_HOURS = 30;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const db = adminClient();
  const { data, error } = await db
    .from('crm_backup_runs')
    .select('started_at, ok, failed')
    .order('started_at', { ascending: false })
    .limit(1);
  if (error) { console.error('[backup-watch]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }

  const last = data?.[0];
  const hours = last ? (Date.now() - new Date(last.started_at as string).getTime()) / 36e5 : Infinity;
  let problem: string | null = null;
  if (!last) problem = 'No backup has reported in yet.';
  else if (!last.ok) problem = `Last backup had ${Array.isArray(last.failed) ? last.failed.length : 'some'} problem(s).`;
  else if (hours > STALE_HOURS) problem = `No backup in ${Math.floor(hours)} hours — the Mac may be asleep or off.`;

  if (!problem) return NextResponse.json({ ok: true, alerted: false });

  const r = await sendPushToProfiles(await superAdminIds(db), {
    title: 'CRM backup needs attention',
    body: problem,
    url: '/crm',
    tag: 'backup-watch',
    category: 'mentions',
    businessUnit: 'commercial',
  }, { ignoreCategory: true, db });
  return NextResponse.json({ ok: false, alerted: true, problem, ...r });
}
