import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isSuperAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { fetchGaReport } from '@/lib/ga4';

/**
 * Lead Attribution — owner-only.
 *
 * Answers "what is bringing leads to the websites": the first-party panels
 * come from our own tables, the GA panels from the GA4 Data API.
 *
 * ACCESS: super_admin ONLY, enforced here rather than in the UI. This report
 * aggregates every agent's leads and the whole contact book, so an ordinary
 * admin must not see it — the nav gate in CRMApp is cosmetic and a hand-rolled
 * fetch would bypass it. Mirrors the copilot-activity report: the server is the
 * boundary. The underlying RPC also has EXECUTE revoked from `authenticated`,
 * so an agent cannot reach the same aggregates through PostgREST directly.
 *
 * The aggregation runs in Postgres (lead_attribution_report) rather than here.
 * PostgREST caps responses at 1000 rows regardless of .limit(), so tallying
 * crm_clients in JS silently charted only the most recent month — it rendered
 * fine and was wrong.
 *
 * ?site=<host> scopes every panel to one site; omitted or unrecognised means
 * the combined view. The scoping happens in SQL because the panels are already
 * aggregated there — the client has counts, not rows, so it could not filter
 * them without showing all-sites numbers under a single-site heading.
 *
 * GA is optional. With no GA4_* env configured the route still returns every
 * first-party panel plus `ga.status.connected === false`, so the dashboard
 * shows a "Connect Google Analytics" placeholder instead of an error.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isSuperAdminRole(ctx.role)) {
    // 403, not 404: the caller is a real authenticated user who simply may not
    // read this. No data shape leaks either way.
    return NextResponse.json({ error: 'Lead attribution is limited to the account owner.' }, { status: 403 });
  }

  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get('days') ?? 90) || 90, 7), 365);

  // Site filter. Restricted to a known list rather than passed through: the
  // value reaches a SQL function, and an allow-list means an unexpected string
  // can never silently return an empty dashboard that looks like "no leads".
  const SITES = ['crecotx.com', 'fairoaksrealtygroup.com', 'elkhornpoint.com'];
  const raw = req.nextUrl.searchParams.get('site');
  const site = raw && SITES.includes(raw) ? raw : null;   // null = all sites

  try {
    const db = adminClient();
    const { data, error } = await db.rpc('lead_attribution_report', { window_days: days, p_site: site });
    if (error) throw error;

    // GA never blocks the first-party payload: a missing key, a revoked
    // service account or a GA outage all degrade to `connected: false`.
    const ga = await fetchGaReport(days);

    return NextResponse.json({ ...(data ?? {}), ga });
  } catch (e) {
    console.error('[lead-attribution]', e);
    return NextResponse.json({ error: 'Could not load lead attribution.' }, { status: 500 });
  }
}
