import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { gmailReplies, workspaceReplyScope } from '@/lib/campaign-replies';
import { cachedCompute, cacheKey } from '@/lib/engagement-cache';
import { computeCallList } from '@/lib/engagement-calllist';
import { buildCampaignList } from '@/lib/campaign-list';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/reply-scan
 *
 * Keeps the Gmail reply scan cache (crm_gmail_scan_cache) warm for the Marketing call
 * list, so the first open of the day — or after a lull — is not a 6–11s Gmail crawl.
 * For each business unit it scans the same workspace-wide scope /api/campaigns/engagement
 * uses, as each admin who has Gmail connected (which also covers the campaign senders'
 * inboxes). gmailReplies() skips anything scanned in the last 3 minutes.
 *
 * It then rebuilds what the CRM reads first — each admin's Marketing call list and each
 * workspace's campaign list + engagement counts — into the persistent cache
 * (crm_engagement_cache), so those loads are a single row read instead of ~1s of queries.
 *
 * Secured by CRON_SECRET, like every other cron.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const t0 = Date.now();
  const db = adminClient();
  const out: Record<string, unknown> = {};
  try {
    const { data: conns } = await db.from('gmail_connections').select('user_id');
    const connected = [...new Set((conns ?? []).map(c => c.user_id as string))];
    const { data: admins } = connected.length
      ? await db.from('crm_profiles').select('id, role, business_unit').in('id', connected).in('role', ['admin', 'super_admin'])
      : { data: [] as { id: string; role: string; business_unit: string | null }[] };
    const adminIds = (admins ?? []).map(a => a.id as string);
    for (const unit of ['commercial', 'residential']) {
      const inScope = await workspaceReplyScope(db, unit);
      if (!inScope.length || !adminIds.length) { out[unit] = { campaigns: inScope.length, scanned: 0 }; continue; }
      let scanned = 0;
      for (const uid of adminIds.slice(0, 4)) {
        const r = await gmailReplies(db, uid, true, inScope).catch(e => { console.error('[cron/reply-scan]', unit, e); return null; });
        if (r) scanned += r.repliesChecked.length;
      }
      out[unit] = { campaigns: inScope.length, scanned };
    }

    // Persistent read models. Gmail is already scanned above, so these are DB work only.
    const warmed: string[] = [];
    for (const a of (admins ?? []).slice(0, 4)) {
      const ctx = { userId: a.id as string, role: a.role as string, businessUnit: (a.business_unit as string | null) ?? null };
      const unit = ctx.businessUnit;
      if (unit) {
        await cachedCompute(db, `calllist|${cacheKey(ctx.userId, null, unit)}`, () => computeCallList(db, ctx, { campaignId: null, unit }),
          { freshMs: 0, staleMs: 0, force: true }, r => r.status === 200)
          .then(() => warmed.push(`calllist:${unit}`)).catch(e => console.error('[cron/reply-scan] calllist', e));
      }
    }
    // The campaign list builds its own cache entries as a side effect of running.
    for (const unit of ['commercial', 'residential']) {
      await buildCampaignList({ userId: adminIds[0] ?? '', role: 'admin', businessUnit: unit }, unit)
        .then(r => { if (r.ok) warmed.push(`list:${unit}`); }).catch(e => console.error('[cron/reply-scan] list', e));
    }
    out.warmed = warmed;
    // The caches are a read-through optimisation: drop rows nobody has touched in 3 days.
    await db.from('crm_engagement_cache').delete().lt('computed_at', new Date(Date.now() - 3 * 86400_000).toISOString());
  } catch (e) {
    console.error('[cron/reply-scan]', e);
    return NextResponse.json({ ok: false, error: (e as Error).message, ms: Date.now() - t0 });
  }
  return NextResponse.json({ ok: true, ms: Date.now() - t0, ...out });
}
