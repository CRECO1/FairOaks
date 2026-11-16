import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, unauthorized, isAdminRole } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { computeInquiryDigest } from '@/lib/inquiry-digest';

export const dynamic = 'force-dynamic';

/** GET /api/crm/inquiry-digest-preview — admins: exactly what the next morning inquiry alert would say to each listing agent right now. Sends NOTHING. */
export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  if (!isAdminRole(ctx.role)) return NextResponse.json({ error: 'Admins only' }, { status: 403 });
  const db = adminClient();
  const { listings, messages } = await computeInquiryDigest(db);
  const { data: profs } = messages.length ? await db.from('crm_profiles').select('id, first_name, last_name').in('id', messages.map(m => m.profileId)) : { data: [] };
  const name = new Map((profs ?? []).map(p => [p.id as string, `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()]));
  return NextResponse.json({ listings, messages: messages.map(m => ({ to: name.get(m.profileId) || 'Agent', title: m.title, body: m.body })) });
}
