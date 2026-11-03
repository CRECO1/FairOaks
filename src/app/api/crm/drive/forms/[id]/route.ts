import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';

// Preview / download link for a form filed in Drive: a fresh one-hour link to the PDF of its last save (null while it has only ever been
// a blank in progress). The Drive row is read as the signed-in user, then the saved form is checked with the forms rule (crm_form_can).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();
  const { data: link } = await dc.userDb.from('crm_drive_forms').select('id,submission_id,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!link || link.trashed_at) return notFound('That form is not available');
  const { data: ok } = await dc.admin.rpc('crm_form_can', { p_uid: dc.ctx.userId, p_sub: link.submission_id });
  if (ok !== true) return notFound('That form is not available');
  const { data: sub } = await dc.admin.from('crm_form_submissions').select('title,filled_path,form_id').eq('id', link.submission_id).single();
  if (!sub) return notFound();
  let url: string | null = null;
  if (sub.filled_path) {
    const dl = req.nextUrl.searchParams.get('download') === '1';
    const { data } = await dc.admin.storage.from('transaction-forms').createSignedUrl(sub.filled_path as string, 3600, dl ? { download: `${String(sub.title ?? 'Form').replace(/[\\/:*?"<>|]+/g, '-')}.pdf` } : undefined);
    url = data?.signedUrl ?? null;
  }
  return NextResponse.json({ url, title: sub.title, form_id: sub.form_id, submission_id: link.submission_id });
}
