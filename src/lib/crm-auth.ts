import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase-admin';
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

/** Role tiers that pass an admin gate. `super_admin` is a strict superset of `admin`. */
export const ADMIN_ROLES = ['admin', 'super_admin'] as const;

/**
 * Returns the authenticated user only if they are admin OR super_admin.
 *
 * NOTE: this previously tested `role !== 'admin'`, which locked super_admins out of every
 * admin-gated route. The rbac-super-admin migration is live in the database, so that check
 * has to accept both tiers.
 */
export async function getCrmAdmin(req?: NextRequest) {
  const user = await getCrmUser(req);
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
  if (!isAdminRole(data?.role as string | undefined)) return null;
  return user;
}

/** Returns the authenticated user only if they have role='super_admin'. */
export async function getCrmSuperAdmin(req?: NextRequest) {
  const user = await getCrmUser(req);
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
  if (data?.role !== 'super_admin') return null;
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

/**
 * 404 for cross-tenant / unauthorized-object access. We deliberately return "not found"
 * rather than 403 so the status code can't be used to confirm a record exists in another
 * workspace.
 */
export function notFound(msg = 'Not found') {
  return NextResponse.json({ error: msg }, { status: 404 });
}

/** True when the role is an admin tier (admin or super_admin). */
export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && (ADMIN_ROLES as readonly string[]).includes(role);
}

/** The authenticated caller plus the workspace fields every scoped route needs. */
export interface CrmContext {
  userId: string;
  role: string | null;
  businessUnit: string | null;
}

/**
 * Full caller context in one place: the user id plus their crm_profiles role and
 * business_unit. Prefer this over getCrmUser() in any route that must scope data to
 * the caller's workspace, so authorization no longer depends on RLS alone (the API
 * routes use the service-role key, which bypasses RLS by design).
 */
export async function getCrmContext(req?: NextRequest): Promise<CrmContext | null> {
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

/**
 * Loads `id` from `table` and returns the row only if the caller may act on it.
 *
 * Admins/super-admins see everything. Everyone else is confined to their own
 * `business_unit`, and — when `requireOwner` is set — to rows they own through one of
 * `ownerColumns` (e.g. `agent_id`, `created_by`).
 *
 * Returns null for both "no such row" and "not yours" so callers can answer 404 either
 * way and never confirm that a record exists in another workspace.
 *
 * Only for tables that carry `business_unit`. Child tables that don't (crm_listing_files,
 * crm_deal_docs) must be scoped through their parent row instead.
 */
export async function assertOwnsResource(
  table: string,
  id: string,
  ctx: CrmContext,
  opts: { ownerColumns?: string[]; requireOwner?: boolean } = {},
): Promise<Record<string, unknown> | null> {
  const { ownerColumns = [], requireOwner = false } = opts;
  const select = ['id', 'business_unit', ...ownerColumns].join(', ');
  const { data } = await adminClient().from(table).select(select).eq('id', id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  if (isAdminRole(ctx.role)) return row;
  if (row.business_unit !== ctx.businessUnit) return null;
  if (requireOwner && !ownerColumns.some(col => row[col] === ctx.userId)) return null;
  return row;
}
