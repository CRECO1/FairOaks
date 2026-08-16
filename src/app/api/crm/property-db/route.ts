import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, isAdminRole, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Read-side for the broker-ingested Property DB (crm_prospective_properties).
// The write-side is src/lib/broker-ingest/* (the 4x/day Gmail → CRM pipeline).
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const unit = isAdminRole(ctx.role) ? (req.nextUrl.searchParams.get('business_unit') ?? ctx.businessUnit ?? 'commercial') : (ctx.businessUnit ?? 'commercial');
  const supabase = adminClient();
  // PostgREST caps a single response at 1000 rows, so page through until the
  // whole table is fetched — the Property DB is well past 1000 listings now.
  const PAGE = 1000;
  const all: unknown[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data, error } = await supabase
      .from('crm_prospective_properties')
      .select('*')
      .eq('business_unit', unit)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[api/property-db] db error:', error);
      return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
  }
  return NextResponse.json({ properties: all });
}
