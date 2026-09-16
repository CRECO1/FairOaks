import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// List the transaction-doc form templates (crm_forms) for a business unit.
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = isAdminRole(ctx.role) ? (req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_forms')
    .select('id, name, form_code, category, page_count, storage_path, created_at, pinned')
    .eq('business_unit', unit)
    .order('name', { ascending: true });
  if (error) {
    console.error('[api/forms] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
  // Metadata only — the picker/dropdown just needs names & categories. Signing a
  // short-lived URL for EVERY form's blank PDF here cost a Supabase storage round-trip
  // per form (~1s+ total, and a thundering herd on a cold start) for links the list
  // rarely uses. The blank's signed URL is fetched on demand when a form is actually
  // opened — GET /api/crm/forms/[id]/url — which every open path already does.
  const forms = (data ?? []).map(f => ({ ...f, url: null as string | null }));
  return NextResponse.json({ forms });
}
