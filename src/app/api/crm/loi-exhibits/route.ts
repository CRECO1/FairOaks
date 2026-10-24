import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { canAccessLinked } from '@/lib/crm-linked-access';
import { exhibitPathAllowed } from '@/lib/loi-generate';
import type { LoiExhibit } from '@/lib/loi-spec';

export const runtime = 'nodejs';

/**
 * GET /api/crm/loi-exhibits?submission_id=…&id=…  → { url }
 * A short-lived signed link to one exhibit attached to a Letter of Intent, so the LOI builder (which renders the
 * PDF in the browser) can fetch the file and rebuild the combined PDF. The file itself never passes through
 * this function (Vercel's 4.5 MB response limit); the caller must be able to open the submission, and the id
 * must be an exhibit actually recorded on it — the storage path is never taken from the request.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const submissionId = req.nextUrl.searchParams.get('submission_id') ?? '';
  const id = req.nextUrl.searchParams.get('id') ?? '';
  if (!submissionId || !id) return NextResponse.json({ error: 'submission_id and id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_form_submissions', submissionId, ctx))) return notFound('Document not found');
  const db = adminClient();
  const { data: sub } = await db.from('crm_form_submissions').select('builder_data, business_unit, deal_id, listing_id').eq('id', submissionId).maybeSingle();
  if (!sub || !(await canAccessLinked(ctx, sub))) return notFound('Document not found');
  const ex = ((sub.builder_data as { exhibits?: LoiExhibit[] } | null)?.exhibits ?? []).find(e => e.id === id);
  // Re-validated at read time (stored data may predate the save-time check): the file must live under this
  // letter's own attachments or on the property the letter is filed on — never an arbitrary bucket path.
  if (!ex || !exhibitPathAllowed(ex.path, submissionId, (sub.listing_id as string | null) ?? null)) return notFound('Exhibit not found');
  const { data, error } = await db.storage.from('listing-files').createSignedUrl(ex.path, 600);
  if (error || !data) return NextResponse.json({ error: 'Could not open the exhibit' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
