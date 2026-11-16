import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { buildOwnerUpdate, saveOwnerUpdateDraft } from '@/lib/owner-update';
import { recordJobRun } from '@/lib/job-runs';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/owner-update-drafts — Mondays. For each property with a landlord / owner contact and any tagged interest, saves a weekly owner update as a
 * DRAFT in the listing agent's Drafts. It never sends an email and never contacts the owner: the agent reviews and sends it. Secured by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = adminClient();
  try {
    const { data: lst } = await db.from('crm_listings').select('id, listing_agent_id, business_unit').not('listing_agent_id', 'is', null).eq('status', 'active').limit(300);
    const agents = [...new Set((lst ?? []).map(l => l.listing_agent_id as string))];
    const { data: profs } = agents.length ? await db.from('crm_profiles').select('id, role, business_unit').in('id', agents) : { data: [] };
    const prof = new Map((profs ?? []).map(p => [p.id as string, p]));
    let made = 0, skipped = 0, toSelf = 0;
    for (const l of lst ?? []) {
      const p = prof.get(l.listing_agent_id as string); if (!p) { skipped++; continue; }
      const ctx = { userId: p.id as string, role: (p.role as string | null) ?? null, businessUnit: (p.business_unit as string | null) ?? (l.business_unit as string | null) };
      const u = await buildOwnerUpdate(db, ctx, l.id as string).catch(() => null);
      if (!u) { skipped++; continue; }       // nothing to report
      await saveOwnerUpdateDraft(db, p.id as string, u).then(() => { made++; if (u.selfAddressed) toSelf++; }).catch(() => { skipped++; });
    }
    await recordJobRun(db, 'owner-update-drafts', true, `${made} owner update draft${made === 1 ? '' : 's'} saved for review (nothing sent)${toSelf ? `, ${toSelf} addressed to the agent because no owner email is linked` : ''}; ${skipped} propert${skipped === 1 ? 'y' : 'ies'} had nothing to report`, { made, skipped, toSelf });
    return NextResponse.json({ made, skipped, toSelf });
  } catch (e) {
    await recordJobRun(db, 'owner-update-drafts', false, `Failed: ${(e as Error).message}`.slice(0, 300));
    return NextResponse.json({ error: 'failed' }, { status: 500 });
  }
}
