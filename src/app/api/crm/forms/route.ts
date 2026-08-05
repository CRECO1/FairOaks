import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// List the transaction-doc form templates (crm_forms) for a business unit.
export async function GET(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const unit = req.nextUrl.searchParams.get('business_unit') ?? 'commercial';
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_forms')
    .select('id, name, form_code, category, page_count, storage_path, created_at')
    .eq('business_unit', unit)
    .order('name', { ascending: true });
  if (error) {
    console.error('[api/forms] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
  return NextResponse.json({ forms: data ?? [] });
}
