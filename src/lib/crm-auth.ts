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

/** Role tiers, most-privileged first. super_admin ⊃ admin ⊃ agent. */
export const ADMIN_ROLES = ['admin', 'super_admin'] as const;

/** Fetch the caller's crm_profiles.role (or null). */
async function getCrmRole(req?: NextRequest): Promise<string | null> {
  const user = await getCrmUser(req);
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
  return (data?.role as string | undefined) ?? null;
}

/**
 * Returns the authenticated user only if they are admin OR super_admin.
 * (super_admin is a strict superset of admin, so it passes every admin gate.)
 */
export async function getCrmAdmin(req?: NextRequest) {
  const role = await getCrmRole(req);
  if (!role || !ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number])) return null;
  return await getCrmUser(req);
}

/** Returns the authenticated user only if they have role='super_admin'. */
export async function getCrmSuperAdmin(req?: NextRequest) {
  const role = await getCrmRole(req);
  if (role !== 'super_admin') return null;
  return await getCrmUser(req);
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
