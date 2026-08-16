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
  // Attach a short-lived signed URL for each form's blank PDF so the client can
  // open it directly (top-level, not framed — avoids the frame-src CSP).
  const forms = await Promise.all((data ?? []).map(async f => {
    const { data: signed } = await supabase.storage
      .from('transaction-forms').createSignedUrl(f.storage_path, 3600);
    return { ...f, url: signed?.signedUrl ?? null };
  }));
  return NextResponse.json({ forms });
}
