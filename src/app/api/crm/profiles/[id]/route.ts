import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, isSuperAdminRole, forbidden, dbError, notFound } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const ctx = await getCrmContext(req);
  if (!ctx) return forbidden('Not authenticated');

  const isAdmin = isAdminRole(ctx.role);
  // Only admins may edit another agent's profile.
  if (ctx.userId !== id && !isAdmin) return forbidden('Cannot update another agent\'s profile');

  const body = await req.json().catch(() => null);
  if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });

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

  // Role change is super-admin-only and MUST run here, server-side: RLS limits
  // authenticated writes on crm_profiles to the caller's OWN row, so the browser
  // cannot change anyone else's role (the write silently affects 0 rows). The
  // service client bypasses RLS, and crm_guard_profile_change() defers to the
  // route for service-role writes — so these checks ARE the guard.
  if ('role' in body && body.role !== undefined) {
    if (!isSuperAdminRole(ctx.role)) return forbidden('Only a super admin can change a user\'s role');
    if (ctx.userId === id) return forbidden('You cannot change your own role');
    if (body.role !== 'agent' && body.role !== 'admin') {
      return NextResponse.json({ error: 'Role must be "agent" or "admin"' }, { status: 400 });
    }
    const { data: target } = await adminClient().from('crm_profiles').select('role').eq('id', id).single();
    if (!target) return notFound('Agent not found');
    if (target.role === 'super_admin') return forbidden('A super admin\'s role cannot be changed here');
    update.role = body.role;
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

  if (error) return dbError('api/crm/profiles/[id]', error);
  return NextResponse.json({ profile: data });
}
