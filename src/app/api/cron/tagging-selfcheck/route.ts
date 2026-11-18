import { safeEqual } from '@/lib/secret-compare';
import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { listingTagToken, parseListingTagIds, suggestListingTag, listingTagLabel } from '@/lib/listing-tags';
import { autoTagIdsForText } from '@/lib/lead-listing-tag';
import { buildOverview, taggedListingIds } from '@/lib/listing-inquiries';
import { computeInquiryDigest } from '@/lib/inquiry-digest';
import { recordJobRun } from '@/lib/job-runs';
import { silentJobs } from '@/lib/job-health';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/tagging-selfcheck — nightly. Pushes a sample note and a sample call summary (built from a real active listing's address) through the real
 * tagging code, runs the interest overview and the morning-alert text builder once (read-only, sends nothing), and writes one line to the job log:
 * green when every check passed, red naming the check that failed. A silent break shows up the next morning instead of weeks later. Secured by CRON_SECRET.
 * Nothing is saved except the log line; nobody is notified.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !safeEqual(req.headers.get('authorization'), `Bearer ${cronSecret}`)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = adminClient();
  const results: { name: string; ok: boolean; note?: string }[] = [];
  const check = async (name: string, fn: () => Promise<string | void>) => {
    try { const note = await fn(); results.push({ name, ok: true, note: note || undefined }); }
    catch (e) { results.push({ name, ok: false, note: (e as Error).message.slice(0, 160) }); }
  };
  try {
    const { data: ls } = await db.from('crm_listings').select('id, name, address, is_restricted').eq('business_unit', 'commercial').eq('status', 'active').not('address', 'is', null).limit(200);
    const listings = (ls ?? []).filter(l => !l.is_restricted && /^\d+\s+\S+/.test(String(l.address ?? '')));
    const sample = listings[0];
    if (!sample) { await recordJobRun(db, 'tagging-selfcheck', false, 'No active listing with a street address to test against'); return NextResponse.json({ ok: false }); }
    const label = listingTagLabel(sample as { id: string; name: string | null; address: string | null });
    const all = listings as { id: string; name: string | null; address: string | null }[];

    await check('typed #tag finds the property', async () => { const ids = parseListingTagIds(`called about #${listingTagToken(sample as never)}`, all); if (!ids.includes(sample.id as string)) throw new Error(`#${listingTagToken(sample as never)} did not match ${label}`); });
    await check('typed address offers a tag', async () => { const sg = suggestListingTag(`asked about ${label} last week`, all); if (!sg || sg.listing.id !== sample.id) throw new Error(`no suggestion for "${label}"`); });
    await check('call summary tags the property', async () => { const ids = await autoTagIdsForText(db, 'commercial', `The caller asked about ${label} and wants 3,000 sq ft.`, []); if (!ids.includes(sample.id as string)) throw new Error(`summary naming ${label} was not tagged`); });
    await check('interest overview builds', async () => { const { data: sa } = await db.from('crm_profiles').select('id').eq('role', 'super_admin').limit(1); const uid = (sa?.[0]?.id as string | undefined) ?? ''; if (!uid) throw new Error('no super_admin profile'); const rows = await buildOverview({ userId: uid, role: 'super_admin', businessUnit: 'commercial' }); if (!Array.isArray(rows)) throw new Error('overview returned no list'); return `${rows.length} properties`; });
    await check('tagged-listing scan runs', async () => { const ids = await taggedListingIds(); return `${ids.length} properties have tags`; });
    await check('scheduled jobs are firing', async () => { const quiet = await silentJobs(db); if (quiet.length) throw new Error(quiet.join('; ')); return 'every scheduled job ran on time'; });
    await check('morning alert text builds (not sent)', async () => { const d = await computeInquiryDigest(db); return `${d.messages.length} alert${d.messages.length === 1 ? '' : 's'} would go out now`; });
  } catch (e) { results.push({ name: 'self-check setup', ok: false, note: (e as Error).message.slice(0, 160) }); }

  const failed = results.filter(r => !r.ok);
  const summary = failed.length ? `FAILED: ${failed.map(f => `${f.name} (${f.note ?? 'error'})`).join('; ')}`.slice(0, 380) : `All ${results.length} checks passed`;
  await recordJobRun(db, 'tagging-selfcheck', failed.length === 0, summary, { results });
  return NextResponse.json({ ok: failed.length === 0, results });
}
