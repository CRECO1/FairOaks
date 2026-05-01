import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST() {
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
