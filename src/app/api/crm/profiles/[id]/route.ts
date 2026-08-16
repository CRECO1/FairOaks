import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getCrmContext(req);
  if (!ctx) return forbidden('Not authenticated');

  const isAdmin = isAdminRole(ctx.role);
  // Only admins may edit another agent's profile.
  if (ctx.userId !== id && !isAdmin) return forbidden('Cannot update another agent\'s profile');

  const body = await req.json();

  // Safe fields — never role, never id. email + business_unit are ADMIN-ONLY:
  // business_unit is the horizontal workspace boundary every scoped guard trusts,
  // so an agent must not be able to move their own profile into the other unit.
  const allowed = isAdmin
    ? ['first_name', 'last_name', 'phone', 'license', 'email', 'business_unit']
    : ['first_name', 'last_name', 'phone', 'license'];
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
