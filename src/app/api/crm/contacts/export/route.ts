import { NextRequest, NextResponse } from 'next/server';
import { getCrmUser, unauthorized } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';

export async function GET(req: NextRequest) {
  const caller = await getCrmUser();
  if (!caller) return unauthorized();
  const unit = req.nextUrl.searchParams.get('unit') ?? 'commercial';
  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_clients')
    .select('first_name,last_name,email,phone,type,business_unit,lead_source,tags,created_at,last_touched_at')
    .eq('business_unit', unit)
    .order('last_name');
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }
  const headers = ['First Name','Last Name','Email','Phone','Type','Business Unit','Lead Source','Tags','Created','Last Touched'];
  const rows = (data ?? []).map(c => [
    c.first_name ?? '', c.last_name ?? '', c.email ?? '', c.phone ?? '',
    c.type ?? '', c.business_unit ?? '', c.lead_source ?? '',
    (c.tags ?? []).join(';'),
    c.created_at ? new Date(c.created_at).toLocaleDateString() : '',
    c.last_touched_at ? new Date(c.last_touched_at).toLocaleDateString() : '',
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="contacts-${unit}-${new Date().toISOString().slice(0,10)}.csv"` } });
}
