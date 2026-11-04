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

  // UPDATE only people who already have a CRM profile. (This used to upsert, which created a full agent profile for anyone who had
  // ever signed up and logged in — profiles are created by the invite flow only.)
  let synced = 0;
  if (updates.length > 0) {
    const { data: existing } = await supabase.from('crm_profiles').select('id').in('id', updates.map(u => u.id));
    const have = new Set((existing ?? []).map(r => r.id as string));
    for (const u of updates) {
      if (!have.has(u.id)) continue;
      const { error } = await supabase.from('crm_profiles').update({ last_sign_in_at: u.last_sign_in_at }).eq('id', u.id);
      if (!error) synced++;
    }
  }

  return NextResponse.json({ synced });
}
