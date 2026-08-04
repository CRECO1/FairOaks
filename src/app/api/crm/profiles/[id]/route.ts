import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, forbidden, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Fields a user may change on their OWN profile.
const SELF_FIELDS  = ['first_name', 'last_name', 'phone', 'license'];
// Additional fields only an admin may change (identity + workspace assignment).
const ADMIN_FIELDS = [...SELF_FIELDS, 'email', 'business_unit'];

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getCrmContext(req);
  if (!ctx) return forbidden('Not authenticated');

  const callerIsAdmin = isAdminRole(ctx.role);
  // A user may edit their own profile; only admins/super-admins may edit anyone else's.
  if (ctx.userId !== id && !callerIsAdmin) {
    return forbidden('Cannot update another agent\'s profile');
  }

  const body = await req.json();

  // Non-admins editing their own profile cannot change email or business_unit
  // (business_unit controls workspace access; email is the login identity).
  const allowed = callerIsAdmin ? ADMIN_FIELDS : SELF_FIELDS;
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
