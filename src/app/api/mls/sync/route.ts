/**
 * POST /api/mls/sync
 *
 * Pulls active & pending listings from SABOR's RESO Web API and upserts
 * them into the `listings` Supabase table.
 *
 * Filterable via env vars:
 *   SABOR_MLS_FILTER   - raw OData $filter string (overrides all below)
 *   SABOR_AGENT_EMAIL  - sync only listings for this agent's email
 *   SABOR_OFFICE_KEY   - sync only listings for this office key
 *
 * If none of the above are set, syncs all Active + Pending listings
 * (use with caution — SABOR has thousands of listings).
 *
 * Body (optional JSON):
 *   { filter?: string }  — override filter for this call only
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getCrmAdmin } from '@/lib/crm-auth';
import { ACTIVE_FILTER } from '@/lib/sabor-reso';
import { runMlsSync } from '@/lib/mls-sync';

function buildFilter(overrideFilter?: string): string {
  if (overrideFilter) return overrideFilter;
  if (process.env.SABOR_MLS_FILTER) return process.env.SABOR_MLS_FILTER;

  // Use OData enum syntax — SABOR StandardStatus values are uppercase
  const parts: string[] = [ACTIVE_FILTER];

  if (process.env.SABOR_AGENT_MLS_ID) {
    // Filter to this agent's listings only
    parts.push(`ListAgentMlsId eq '${process.env.SABOR_AGENT_MLS_ID}'`);
  } else if (process.env.SABOR_OFFICE_NAME) {
    parts.push(`ListOfficeName eq '${process.env.SABOR_OFFICE_NAME}'`);
  }

  return parts.join(' and ');
}

export async function POST(req: NextRequest) {
  // Accept either:
  //  (a) Internal cron call — x-internal-key must equal INTERNAL_SYNC_SECRET (dedicated secret, not service role key)
  //  (b) Admin JWT Bearer token (from CRM browser session)
  //  (c) Admin cookie session (fallback)
  const internalKey = req.headers.get('x-internal-key');
  const syncSecret = process.env.INTERNAL_SYNC_SECRET;
  const isInternalCron = syncSecret && internalKey === syncSecret;

  if (!isInternalCron) {
    let isAdmin = false;

    // Prefer explicit Bearer JWT over cookie-based auth
    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (bearerToken && bearerToken !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      // Verify the JWT and check admin role directly
      const verifier = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
      );
      const { data: { user } } = await verifier.auth.getUser(bearerToken);
      if (user) {
        const { data } = await verifier.from('crm_profiles').select('role').eq('id', user.id).single();
        isAdmin = data?.role === 'admin' || data?.role === 'super_admin';
      }
    } else {
      // Fallback: cookie-based session
      isAdmin = !!(await getCrmAdmin());
    }

    if (!isAdmin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    let overrideFilter: string | undefined;
    try {
      const body = await req.json().catch(() => null);
      if (body === null) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
      overrideFilter = body?.filter;
    } catch {
      // no body / not JSON — fine
    }

    const filter = buildFilter(overrideFilter);
    const result = await runMlsSync(filter);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error('[MLS sync] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
