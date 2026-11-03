import { NextRequest, NextResponse } from 'next/server';
import { unauthorized, notFound, assertOwnsResource } from '@/lib/crm-auth';
import { driveContext } from '@/lib/drive-server';

// "Add to a deal…" for a form filed in Drive: put a COPY of it on the deal card — a new saved form on the deal with the same fields,
// letter data and (if it has one) saved PDF. The Drive copy and the deal's copy are separate from then on. Deal access follows the
// deal's own rules (same check as attaching a file to a deal).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const { id } = await params;
  const body = await req.json().catch(() => ({})) as { deal_id?: string };
  if (!UUID_RE.test(id) || !body.deal_id || !UUID_RE.test(body.deal_id)) return NextResponse.json({ error: 'Pick a deal' }, { status: 400 });
  const { data: link } = await dc.userDb.from('crm_drive_forms').select('id,submission_id,trashed_at').eq('id', id).eq('business_unit', dc.bu).maybeSingle();
  if (!link || link.trashed_at) return notFound('That form is not available');
  const { data: ok } = await dc.admin.rpc('crm_form_can', { p_uid: dc.ctx.userId, p_sub: link.submission_id });
  if (ok !== true) return notFound('That form is not available');
  if (!(await assertOwnsResource('crm_deals', body.deal_id, dc.ctx))) return notFound('Deal not found');

  const { data: src } = await dc.admin.from('crm_form_submissions').select('form_id,title,values,builder_data,filled_path').eq('id', link.submission_id).single();
  if (!src) return notFound('That form is not available');
  let filled: string | null = null;
  if (src.filled_path) {
    const dst = `submissions/${src.form_id ?? 'imported'}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.pdf`;
    const { error } = await dc.admin.storage.from('transaction-forms').copy(src.filled_path as string, dst);
    if (!error) filled = dst;
  }
  const { data: made, error } = await dc.admin.from('crm_form_submissions').insert({
    form_id: src.form_id, business_unit: dc.bu, deal_id: body.deal_id, title: src.title, values: src.values ?? [], builder_data: src.builder_data ?? null,
    status: 'saved', created_by: dc.ctx.userId, filled_path: filled,
  }).select('id').single();
  if (error || !made) { console.error('[drive/forms/to-deal]', error); return NextResponse.json({ error: 'Could not add the form to the deal' }, { status: 500 }); }
  return NextResponse.json({ ok: true, submission_id: made.id, has_pdf: !!filled });
}
