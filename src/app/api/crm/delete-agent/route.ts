import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = 'https://bnqdzgypesoythpbeujk.supabase.co';

export async function POST(req: NextRequest) {
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
      console.error('Delete user error:', data);
      return NextResponse.json({ error: data.msg || data.message || JSON.stringify(data) }, { status: 400 });
    }

    // Also remove from crm_profiles (in case cascade didn't catch it)
    await fetch(`${SUPABASE_URL}/rest/v1/crm_profiles?id=eq.${userId}`, {
      method: 'DELETE',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Delete agent route error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
