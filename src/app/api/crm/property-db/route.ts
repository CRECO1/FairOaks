import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

// Read-side for the broker-ingested Property DB (crm_prospective_properties).
// The write-side is src/lib/broker-ingest/* (the 4x/day Gmail → CRM pipeline).
export async function GET(req: NextRequest) {
  const caller = await getCrmUser(req);
  if (!caller) return unauthorized();
  const unit = req.nextUrl.searchParams.get('business_unit') ?? 'commercial';
  const supabase = adminClient();
  const { data, error } = await supabase
    .from('crm_prospective_properties')
    .select('*')
    .eq('business_unit', unit)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[api/property-db] db error:', error);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
  return NextResponse.json({ properties: data ?? [] });
}
