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
import {
  searchPropertiesAll,
  getMediaBatch,
  resoPropertyToListing,
  ACTIVE_FILTER,
} from '@/lib/sabor-reso';

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

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
  //  (a) Internal cron call — x-internal-key must equal the service role key
  //  (b) Admin CRM session
  const internalKey = req.headers.get('x-internal-key');
  const isInternalCron = internalKey && internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!isInternalCron) {
    const admin = await getCrmAdmin();
    if (!admin) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    let overrideFilter: string | undefined;
    try {
      const body = await req.json();
      overrideFilter = body?.filter;
    } catch {
      // no body / not JSON — fine
    }

    const filter = buildFilter(overrideFilter);

    // ── Fetch all matching properties from SABOR ──────────────────────────────
    const properties = await searchPropertiesAll(
      { filter, orderby: 'ModificationTimestamp desc', top: 200 },
      50 // max 50 pages = up to 10,000 records per sync
    );

    if (properties.length === 0) {
      return NextResponse.json({ synced: 0, updated: 0, skipped: 0 });
    }

    // ── Fetch media for all listings in batches ───────────────────────────────
    const listingIds = properties.map(p => p.ListingId);
    const mediaMap = await getMediaBatch(listingIds);

    // ── Upsert into Supabase ──────────────────────────────────────────────────
    const supabase = adminClient();
    let synced = 0;
    let failed = 0;

    // Process in chunks of 50 to stay within Supabase payload limits
    const CHUNK = 50;
    for (let i = 0; i < properties.length; i += CHUNK) {
      const chunk = properties.slice(i, i + CHUNK);
      const rows = chunk.map(p => {
        const images = mediaMap.get(p.ListingId) ?? [];
        return resoPropertyToListing(p, images);
      });

      const { error } = await supabase
        .from('listings')
        .upsert(rows, {
          onConflict: 'listing_key',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('[MLS sync] upsert error:', error);
        failed += chunk.length;
      } else {
        synced += chunk.length;
      }
    }

    // ── Mark listings no longer in SABOR feed as off-market ──────────────────
    // Only for MLS-sourced listings — never touch manually entered ones
    if (listingIds.length > 0 && !overrideFilter) {
      // Find MLS listings we have that are NOT in the current feed
      const { data: stale } = await supabase
        .from('listings')
        .select('id, listing_key, title')
        .eq('source', 'mls')
        .in('status', ['active', 'pending'])
        .not('listing_key', 'in', `(${listingIds.map(k => `'${k}'`).join(',')})`)
        .limit(500);

      if (stale && stale.length > 0) {
        const staleIds = stale.map((r: any) => r.id);
        await supabase
          .from('listings')
          .update({ status: 'off-market', synced_at: new Date().toISOString() })
          .in('id', staleIds);
      }
    }

    return NextResponse.json({
      synced,
      failed,
      total: properties.length,
      filter,
    });
  } catch (err: any) {
    console.error('[MLS sync] error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
