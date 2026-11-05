import { NextRequest, NextResponse } from 'next/server';
import { unauthorized } from '@/lib/crm-auth';
import { driveContext, likePattern } from '@/lib/drive-server';

export const dynamic = 'force-dynamic';

// GET ?q= → contacts and deals the caller can open that match, for "@" mentions in a document. Read through the caller's own
// database session, so they only ever get what the contact / deal lists would show them.
export async function GET(req: NextRequest) {
  const dc = await driveContext(req);
  if (!dc) return unauthorized();
  const q = (req.nextUrl.searchParams.get('q') ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 40);
  if (q.length < 1) return NextResponse.json({ results: [] });
  const pat = likePattern(q);
  const [c, d] = await Promise.all([
    dc.userDb.from('crm_clients').select('id,first_name,last_name,business_name').eq('business_unit', dc.bu)
      .or(`first_name.ilike.${pat},last_name.ilike.${pat},business_name.ilike.${pat}`).limit(6),
    dc.userDb.from('crm_deals').select('id,client,property').eq('business_unit', dc.bu)
      .or(`client.ilike.${pat},property.ilike.${pat}`).limit(5),
  ]);
  const results = [
    ...(c.data ?? []).map(x => ({ kind: 'contact' as const, id: x.id as string, label: [[x.first_name, x.last_name].filter(Boolean).join(' '), x.business_name].filter(Boolean).join(' · ') || 'Contact' })),
    ...(d.data ?? []).map(x => ({ kind: 'deal' as const, id: x.id as string, label: [x.client, x.property].filter(Boolean).join(' · ') || 'Deal' })),
  ];
  return NextResponse.json({ results });
}
