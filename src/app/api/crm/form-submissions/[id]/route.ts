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
  // Edit history (audit trail) with editor names resolved.
  const { data: rawEdits } = await supabase.from('crm_form_submission_edits')
    .select('id, editor_id, summary, changes, created_at').eq('submission_id', id).order('created_at', { ascending: false }).limit(50);
  const editorIds = Array.from(new Set((rawEdits ?? []).map(e => e.editor_id).filter(Boolean)));
  const nameById = new Map<string, string>();
  if (editorIds.length) {
    const { data: profs } = await supabase.from('crm_profiles').select('id, first_name, last_name').in('id', editorIds as string[]);
    for (const p of profs ?? []) nameById.set(p.id, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Agent');
  }
  const edits = (rawEdits ?? []).map(e => ({ id: e.id, summary: e.summary, changes: e.changes, created_at: e.created_at, editor: e.editor_id ? (nameById.get(e.editor_id) || 'Agent') : 'System' }));

  return NextResponse.json({ submission: data, blankUrl, filledUrl, edits });
}
