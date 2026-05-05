import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** Returns the authenticated Supabase user from cookies, or null. */
export async function getCrmUser() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** Returns the authenticated user only if they have role='admin' in crm_profiles. */
export async function getCrmAdmin() {
  const user = await getCrmUser();
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
  if (data?.role !== 'admin') return null;
  return user;
}

/** Convenience: return 401 JSON response. */
export function unauthorized(msg = 'Unauthorized') {
  return NextResponse.json({ error: msg }, { status: 401 });
}

/** Convenience: return 403 JSON response. */
export function forbidden(msg = 'Forbidden — admin only') {
  return NextResponse.json({ error: msg }, { status: 403 });
}
