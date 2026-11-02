/**
 * GET /api/cron/prune-uploads — daily. Big files an agent attached from their phone/computer are uploaded straight to
 * private storage under `pending/<user>/<uuid>/<name>` (see /api/crm/attach-upload) and removed when the email goes out.
 * One whose email was never sent (chip removed, draft discarded) would otherwise stay forever, so anything older than
 * 30 days is deleted. (A scheduled email or a long-kept draft that still points at a swept file just gets a clear
 * "attach it again" message.) Secured with CRON_SECRET.
 */
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { EMAIL_ATTACH_BUCKET } from '@/lib/email-attachments';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const KEEP_DAYS = 30;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const st = adminClient().storage.from(EMAIL_ATTACH_BUCKET);
  const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
  const stale: string[] = [];
  let seen = 0;
  const { data: users } = await st.list('pending', { limit: 1000 });
  for (const u of users ?? []) {
    const { data: dirs } = await st.list(`pending/${u.name}`, { limit: 1000 });
    for (const d of dirs ?? []) {
      const { data: files } = await st.list(`pending/${u.name}/${d.name}`, { limit: 100 });
      for (const f of files ?? []) {
        seen++;
        const made = f.created_at ? new Date(f.created_at).getTime() : NaN;
        if (Number.isFinite(made) && made < cutoff) stale.push(`pending/${u.name}/${d.name}/${f.name}`);
      }
    }
  }
  if (stale.length) {
    const { error } = await st.remove(stale);
    if (error) { console.error('[prune-uploads]', error); return NextResponse.json({ error: error.message }, { status: 500 }); }
  }
  return NextResponse.json({ ok: true, seen, removed: stale.length });
}
