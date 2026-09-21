import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, getCrmSuperAdmin, unauthorized, forbidden, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { writeAuditLog } from '@/lib/audit';

/**
 * Bulk export of the contact database — super-admin only.
 *
 * Reading contacts in the CRM one at a time and walking out with the whole
 * book as a CSV are different acts, and only the second one is irreversible.
 * This is the single route that turns the database into a portable file, so
 * it sits behind the narrowest gate we have. Every other contact route is
 * unchanged: admins still read, search and edit exactly as before.
 *
 * To hand it back to an admin, swap getCrmSuperAdmin for getCrmAdmin below.
 */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!(await getCrmSuperAdmin(req))) return forbidden('Exporting contacts is restricted to the account owner.');

  const requested = req.nextUrl.searchParams.get('unit') ?? 'commercial';
  // Agents can only export their own workspace's contacts; admins may pick a unit.
  const unit = isAdminRole(ctx.role) ? requested : (ctx.businessUnit ?? requested);

  const supabase = adminClient();
  const { data, error } = await supabase.from('crm_clients')
    .select('first_name,last_name,email,phone,type,business_unit,lead_source,tags,created_at,last_touched_at')
    .eq('business_unit', unit)
    .order('last_name');
  if (error) { console.error("[api] db error:", error); return NextResponse.json({ error: "Internal server error." }, { status: 500 }); }

  // Record every bulk PII export server-side, so it can't be skipped by the client.
  await writeAuditLog({
    actorId: ctx.userId,
    action: 'export_contacts',
    targetType: 'crm_clients',
    metadata: { unit, count: data?.length ?? 0 },
    req,
  });

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
