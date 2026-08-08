import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Load one submission for re-editing: its saved values + a signed URL to the
// blank form PDF (to re-render the pages) and to the previously generated PDF.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  // Submissions carry transaction PII — confine reads to the caller's workspace.
  if (!(await assertOwnsResource('crm_form_submissions', id, ctx))) return notFound();
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_form_submissions')
    .select('*, crm_forms(name, form_code, storage_path, page_count)')
    .eq('id', id).single();
  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const form = (data as { crm_forms?: { storage_path?: string } }).crm_forms;
  let blankUrl: string | null = null, filledUrl: string | null = null;
  if (form?.storage_path) {
    const { data: b } = await supabase.storage.from('transaction-forms').createSignedUrl(form.storage_path, 3600);
    blankUrl = b?.signedUrl ?? null;
  }
  if (data.filled_path) {
    const { data: f } = await supabase.storage.from('transaction-forms').createSignedUrl(data.filled_path, 3600);
    filledUrl = f?.signedUrl ?? null;
  }
  return NextResponse.json({ submission: data, blankUrl, filledUrl });
}
