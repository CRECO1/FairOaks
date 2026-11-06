import { NextRequest, NextResponse } from 'next/server';
import { getCrmSuperAdmin, getCrmUser, unauthorized, forbidden } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

/**
 * Nightly CRM backup status — OWNER ONLY (super_admin).
 *
 * The backup runs on the owner's Mac (launchd, 2:30 AM) and writes one row per run to
 * crm_backup_runs with the service role. This route only READS them. Enforced here, not
 * just by hiding the nav button: any other role — including admin — gets 403, and the
 * table itself has RLS on with no browser grants.
 */
export async function GET(req: NextRequest) {
  const user = await getCrmSuperAdmin(req);
  if (!user) {
    // Distinguish "not signed in" from "signed in but not the owner" for a clean client message.
    return (await getCrmUser(req)) ? forbidden('Owner only') : unauthorized();
  }
  const db = adminClient();
  const { data, error } = await db
    .from('crm_backup_runs')
    .select('id, started_at, finished_at, ok, tables_count, contacts, new_files, new_bytes, total_files, total_bytes, failed')
    .order('started_at', { ascending: false })
    .limit(30);
  if (error) { console.error('[backup-runs]', error); return NextResponse.json({ error: 'Internal error' }, { status: 500 }); }
  return NextResponse.json({ runs: data ?? [] });
}
