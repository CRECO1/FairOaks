import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Return a short-lived signed URL for a form's blank PDF (private bucket).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  const supabase = adminClient();
  const { data: form, error } = await supabase
    .from('crm_forms').select('storage_path, business_unit').eq('id', id).single();
  if (error || !form) return notFound('Form not found');
  if (!isAdminRole(ctx.role) && form.business_unit !== ctx.businessUnit) return notFound('Form not found');
  const { data, error: signErr } = await supabase.storage
    .from('transaction-forms').createSignedUrl(form.storage_path, 3600);
  if (signErr || !data) return NextResponse.json({ error: 'Could not sign URL' }, { status: 500 });
  return NextResponse.json({ url: data.signedUrl });
}
