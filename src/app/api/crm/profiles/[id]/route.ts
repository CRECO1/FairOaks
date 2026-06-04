import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const caller = await getCrmUser();
  if (!caller) return forbidden('Not authenticated');

  // Allow user to update their own profile; admin can update any
  if (caller.id !== id) {
    const { data: callerProfile } = await adminClient().from('crm_profiles').select('role').eq('id', caller.id).single();
    if (callerProfile?.role !== 'admin') return forbidden('Cannot update another agent\'s profile');
  }

  const body = await req.json();

  // Only allow safe profile fields — never role, never id
  const allowed = ['first_name', 'last_name', 'phone', 'license', 'email', 'business_unit'];
  const update: Record<string, string> = {};
  for (const key of allowed) {
    if (key in body && body[key] !== undefined) {
      update[key] = body[key];
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_profiles')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  return NextResponse.json({ profile: data });
}
