import { NextRequest, NextResponse } from 'next/server';
import { getCrmAdmin, getCrmSuperAdmin, forbidden } from '@/lib/crm-auth';
import { SUPABASE_URL } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

export async function POST(req: NextRequest) {
  const caller = await getCrmAdmin();
  if (!caller) return forbidden();

  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    if (!serviceRoleKey || !anonKey) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    // No one may remove themselves via this route.
    if (userId === caller.id) return forbidden('You cannot remove your own account.');

    // Removing an admin or super_admin is super-admin-only — stops an admin
    // (e.g. Brian) from deleting the super admin or another admin to seize control.
    const targetRes = await fetch(
      `${SUPABASE_URL}/rest/v1/crm_profiles?id=eq.${userId}&select=role`,
      { headers: { apikey: anonKey, Authorization: `Bearer ${serviceRoleKey}` } },
    );
    const targetRows = await targetRes.json().catch(() => []);
    const targetRole: string | undefined = Array.isArray(targetRows) ? targetRows[0]?.role : undefined;
    if (targetRole === 'admin' || targetRole === 'super_admin') {
      if (!(await getCrmSuperAdmin())) return forbidden('Only a super admin can remove an admin.');
    }

    // Delete the user from Supabase Auth (cascades to crm_profiles via RLS/FK)
    const deleteRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    if (!deleteRes.ok) {
      const data = await deleteRes.json();
      console.error('[delete-agent] Supabase delete error:', data);
      return NextResponse.json({ error: 'Failed to delete agent. They may have already been removed.' }, { status: 400 });
    }

    // Also remove from crm_profiles (in case cascade didn't catch it)
    await fetch(`${SUPABASE_URL}/rest/v1/crm_profiles?id=eq.${userId}`, {
      method: 'DELETE',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    await writeAuditLog({
      actorId: caller.id,
      action: 'delete_agent',
      targetType: 'agent',
      targetId: userId,
      metadata: {},
      req,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[delete-agent] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
