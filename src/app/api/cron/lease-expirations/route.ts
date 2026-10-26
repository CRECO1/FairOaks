import { NextRequest, NextResponse } from 'next/server';
import { runLeaseProspecting, runRentRollProspecting } from '@/lib/lease-prospecting';

// Daily: create renewal call tasks for tenants that have entered their lease-
// expiration outreach window. Idempotent (crm_clients.lxp_prospected_for), so it is
// safe to run every day. Secured with CRON_SECRET like every other cron route.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const commercial = await runLeaseProspecting('commercial', { commit: true });
  const residential = await runLeaseProspecting('residential', { commit: true });
  // Leases that exist only on the Rent Roll (no contact, or a contact whose date doesn't match) — lib/lease-prospecting.
  let rentRoll: { created: number; rows: string[] } | { error: string };
  try { rentRoll = await runRentRollProspecting('commercial', { commit: true }); } catch (e) { rentRoll = { error: e instanceof Error ? e.message : String(e) }; console.error('[cron/lease-expirations] rent roll', e); }
  return NextResponse.json({ commercial: commercial.created, residential: residential.created, rentRoll });
}
