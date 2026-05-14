import { NextResponse } from 'next/server';
import { getCrmAdmin } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function POST() {
  // Admin-only: calls auth.admin.listUsers which enumerates all auth accounts
  const caller = await getCrmAdmin();
  if (!caller) return NextResponse.json({ error: 'Forbidden — admin only' }, { status: 403 });

  const supabase = adminClient();

  // Fetch all auth users across all pages (listUsers is paginated)
  const allUsers: { id: string; last_sign_in_at?: string }[] = [];
  let page = 1;
  while (true) {
    const { data: authData, error: authErr } = await supabase.auth.admin.listUsers({ perPage: 1000, page });
    if (authErr) return NextResponse.json({ error: authErr.message }, { status: 500 });
    const batch = authData?.users ?? [];
    allUsers.push(...batch);
    if (batch.length < 1000) break;
    page++;
  }

  const users = allUsers;

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
