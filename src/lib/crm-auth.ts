import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Returns the authenticated Supabase user.
 * Prefers the Bearer token from the Authorization header (sent by the CRM client-side
 * localStorage session) and falls back to the cookie-based SSR session.
 */
export async function getCrmUser(req?: NextRequest) {
  // 1. Try Bearer token from Authorization header first
  const authHeader = req?.headers.get('Authorization') ?? null;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (!error && user) return user;
  }

  // 2. Fall back to cookie-based session (SSR)
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

/** Returns the authenticated user only if they have role='admin' in crm_profiles. */
export async function getCrmAdmin(req?: NextRequest) {
  const user = await getCrmUser(req);
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

/**
 * Logs a database/server error internally and returns a safe generic 500 response.
 * Never expose raw Supabase or database error messages to clients.
 */
export function dbError(context: string, err: { message?: string } | null | unknown, status = 500) {
  console.error(`[${context}]`, err);
  return NextResponse.json({ error: 'An internal server error occurred.' }, { status });
}
