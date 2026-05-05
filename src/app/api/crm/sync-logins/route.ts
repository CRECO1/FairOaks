import { NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function POST() {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();

  const supabase = adminClient();

  // Fetch all auth users (real last_sign_in_at from Supabase Auth)
  const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });

  const users = authData?.users ?? [];

  // Upsert last_sign_in_at into crm_profiles for each user that has signed in
  const updates = users
    .filter(u => u.last_sign_in_at)
    .map(u => ({
      id: u.id,
      last_sign_in_at: u.last_sign_in_at,
    }));

  if (updates.length > 0) {
    await supabase
      .from('crm_profiles')
      .upsert(updates, { onConflict: 'id', ignoreDuplicates: false });
  }

  return NextResponse.json({ synced: updates.length });
}
