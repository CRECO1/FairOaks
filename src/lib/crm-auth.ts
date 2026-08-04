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

/** Role tiers, most-privileged first. `super_admin` ⊃ `admin` ⊃ `agent`. */
export const ADMIN_ROLES = ['admin', 'super_admin'] as const;

/** Fetch the caller's crm_profiles.role (or null). */
async function getCrmRole(req?: NextRequest): Promise<{ userId: string; role: string | null } | null> {
  const user = await getCrmUser(req);
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
  return { userId: user.id, role: (data?.role as string | undefined) ?? null };
}

/**
 * Returns the authenticated user only if they are an admin OR super_admin.
 * (super_admin is a strict superset of admin, so it passes every admin gate.)
 */
export async function getCrmAdmin(req?: NextRequest) {
  const r = await getCrmRole(req);
  if (!r || !r.role || !ADMIN_ROLES.includes(r.role as (typeof ADMIN_ROLES)[number])) return null;
  return await getCrmUser(req);
}

/** Returns the authenticated user only if they have role='super_admin'. */
export async function getCrmSuperAdmin(req?: NextRequest) {
  const r = await getCrmRole(req);
  if (!r || r.role !== 'super_admin') return null;
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

/**
 * Full caller context in one place: the user id plus their crm_profiles role and
 * business_unit. Prefer this over getCrmUser() in any route that must scope data to
 * the caller's workspace, so authorization no longer depends on RLS alone.
 */
export async function getCrmContext(req?: NextRequest): Promise<{ userId: string; role: string | null; businessUnit: string | null } | null> {
  const user = await getCrmUser(req);
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role, business_unit').eq('id', user.id).single();
  return {
    userId: user.id,
    role: (data?.role as string | undefined) ?? null,
    businessUnit: (data?.business_unit as string | undefined) ?? null,
  };
}

/** True when the role is an admin tier (admin or super_admin). */
export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * 404 for cross-tenant / unauthorized-object access. We deliberately return "not found"
 * rather than 403 so the status code can't be used to confirm a record exists in another
 * workspace.
 */
export function notFound(msg = 'Not found') {
  return NextResponse.json({ error: msg }, { status: 404 });
}
