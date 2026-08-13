import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Toggle a form template's `pinned` flag (curated top set in the picker). Admin only.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getCrmAdmin(req);
  if (!admin) return forbidden('Only an admin can change a form.');
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (typeof body.pinned === 'boolean') patch.pinned = body.pinned;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_forms').update(patch).eq('id', id).select('id, pinned').single();
  if (error) { console.error('[api/forms] PATCH', error); return NextResponse.json({ error: 'Update failed' }, { status: 500 }); }
  return NextResponse.json({ form: data });
}
