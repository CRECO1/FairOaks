import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { adminClient } from '@/lib/supabase-admin';
import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Returns the authenticated Supabase user.
 * Prefers the Bearer token from the Authorization header (sent by the CRM client-side
 * localStorage session) and falls back to the cookie-based SSR session.
 */
export async function getCrmUser(req?: NextRequest) {
  // 1. Try Bearer token from Authorization header first. Routes that never pass
  //    `req` (about 35 of them) read the header from the request context, so a
  //    Bearer is honored everywhere — middleware relies on that when it skips the
  //    cookie-session refresh for a request that carries a live Bearer token.
  let authHeader = req?.headers.get('Authorization') ?? null;
  if (!authHeader) {
    try { authHeader = (await headers()).get('authorization'); } catch { authHeader = null; }
  }
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

/**
 * Like getCrmUser(), but fails closed: the login must ALSO have a crm_profiles row.
 *
 * getCrmUser() accepts any Supabase login, and Supabase sign-up is open, so a stranger who registers an
 * account is "authenticated". Any route that spends money (ATTOM, Anthropic), stores files or sends mail,
 * or that touches CRM data, must use this (or getCrmContext) instead. Drop-in replacement: returns the same
 * Supabase user object.
 */
export async function getCrmProfileUser(req?: NextRequest) {
  const user = await getCrmUser(req);
  if (!user) return null;
  const { data } = await adminClient().from('crm_profiles').select('id').eq('id', user.id).maybeSingle();
  return data ? user : null;
}

/** Role tiers, most-privileged first. super_admin ⊃ admin ⊃ agent. */
export const ADMIN_ROLES = ['admin', 'super_admin'] as const;

/**
 * The authenticated user plus their crm_profiles.role (role null if no profile).
 * One auth round trip + one profile read: the admin gates below used to call
 * getCrmUser() a second time just to hand the user back, which doubled the
 * Supabase Auth latency on every admin-only route.
 */
async function getCrmUserWithRole(req?: NextRequest) {
  const user = await getCrmUser(req);
  if (!user) return null;
  const admin = createAdminClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data } = await admin.from('crm_profiles').select('role').eq('id', user.id).single();
  return { user, role: (data?.role as string | undefined) ?? null };
}

/**
 * Returns the authenticated user only if they are admin OR super_admin.
 * (super_admin is a strict superset of admin, so it passes every admin gate.)
 */
export async function getCrmAdmin(req?: NextRequest) {
  const caller = await getCrmUserWithRole(req);
  if (!caller?.role || !ADMIN_ROLES.includes(caller.role as (typeof ADMIN_ROLES)[number])) return null;
  return caller.user;
}

/** Returns the authenticated user only if they have role='super_admin'. */
export async function getCrmSuperAdmin(req?: NextRequest) {
  const caller = await getCrmUserWithRole(req);
  if (caller?.role !== 'super_admin') return null;
  return caller.user;
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
 * Map a Postgres/PostgREST failure to something the person who hit it can act on.
 *
 * Every one of these used to answer "An internal server error occurred." while the
 * real cause went to the server log. That is safe, but it left an agent staring at
 * a failed save with nothing to report and no idea whether to retry, change a
 * field, or call someone — and it left us unable to diagnose from what they told
 * us. These messages name the KIND of problem without leaking column names,
 * constraint names or SQL: the raw error still goes to the log.
 */
function friendlyDbMessage(err: unknown): { message: string; status: number } {
  const code = (err as { code?: string } | null)?.code;
  switch (code) {
    case '23505': return { message: 'That already exists — check for a duplicate and try again.', status: 409 };
    case '23503': return { message: 'Something this record links to no longer exists. Reload the page and try again.', status: 409 };
    case '23514': return { message: "One of the values isn't allowed here. Check the dates, numbers and status fields.", status: 400 };
    case '23502': return { message: 'A required field is missing.', status: 400 };
    case '22P02': return { message: "One of the fields has an invalid value — usually a date, number or selection left half-filled.", status: 400 };
    case '22001': return { message: 'One of the fields is too long.', status: 400 };
    // Undefined column/table means the app and the database disagree about the
    // schema. The agent can't fix that, but they CAN stop retrying, and saying so
    // gets it reported instead of silently repeated.
    case '42703':
    case '42P01': return { message: 'This page is out of date with the server. Reload and try again — if it keeps happening, report it.', status: 500 };
    case '42501': return { message: "You don't have permission to change this record.", status: 403 };
    default:      return { message: 'The save did not go through. Nothing was changed — try again in a moment.', status: 500 };
  }
}

/**
 * Logs a database/server error internally and returns a safe, specific response.
 * Never exposes raw Supabase or database error text to clients.
 */
export function dbError(context: string, err: { message?: string } | null | unknown, status?: number) {
  console.error(`[${context}]`, err);
  const friendly = friendlyDbMessage(err);
  return NextResponse.json({ error: friendly.message }, { status: status ?? friendly.status });
}

/**
 * 404 for cross-tenant / unauthorized-object access. We deliberately return "not found"
 * rather than 403 so the status code can't be used to confirm a record exists in another
 * workspace.
 */
export function notFound(msg = 'Not found') {
  return NextResponse.json({ error: msg }, { status: 404 });
}

/** True only for role='super_admin' — the tier that may destroy records. */
export function isSuperAdminRole(role: string | null | undefined): boolean {
  return role === 'super_admin';
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
  const { data } = await admin.from('crm_profiles').select('role, business_unit').eq('id', user.id).maybeSingle();
  // A login with no CRM profile is NOT a CRM user. This used to return role=null/businessUnit=null, which
  // many routes then treated as "no restrictions" (e.g. `businessUnit ?? 'commercial'`), so anyone who signed
  // up for an auth account could read workspace data through the API. Fail closed.
  if (!data) return null;
  return {
    userId: user.id,
    role: (data.role as string | undefined) ?? null,
    businessUnit: (data.business_unit as string | undefined) ?? null,
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
  const extra = table === 'crm_deals' ? ['is_restricted', 'agent_id', 'assigned_agent_ids'] : [];
  const select = Array.from(new Set(['id', 'business_unit', ...ownerColumns, ...extra])).join(', ');
  const { data } = await adminClient().from(table).select(select).eq('id', id).maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row) return null;
  // Restricted deals: visible only to the owner, assigned agents and super_admin (mirrors crm_deal_visible()).
  if (table === 'crm_deals' && row.is_restricted && ctx.role !== 'super_admin'
    && row.agent_id !== ctx.userId && !((row.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId)) return null;
  if (isAdminRole(ctx.role)) return row;
  if (row.business_unit !== ctx.businessUnit) return null;
  if (requireOwner && !ownerColumns.some(col => row[col] === ctx.userId)) return null;
  return row;
}


/**
 * Restricted ("private") deals the caller may NOT see: flagged is_restricted and the caller is
 * neither the owning agent nor in assigned_agent_ids. super_admin sees everything. Server routes use
 * the service key (bypassing RLS), so each deal-linked list must apply this itself.
 */
export async function hiddenDealIds(ctx: CrmContext): Promise<string[]> {
  if (ctx.role === 'super_admin') return [];
  const { data } = await adminClient().from('crm_deals').select('id, agent_id, assigned_agent_ids').eq('is_restricted', true);
  return (data ?? [])
    .filter(d => d.agent_id !== ctx.userId && !((d.assigned_agent_ids as string[] | null) ?? []).includes(ctx.userId))
    .map(d => d.id as string);
}

/** Adds "deal_id is null OR deal_id not in hidden" to a PostgREST query (no-op when nothing is hidden). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function excludeHiddenDeals<Q extends { or: (f: string) => any }>(q: Q, hidden: string[], col = 'deal_id'): Q {
  return hidden.length ? q.or(`${col}.is.null,${col}.not.in.(${hidden.join(',')})`) : q;
}
