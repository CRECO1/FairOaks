import { NextRequest, NextResponse } from 'next/server';
import { getCrmContext, assertOwnsResource, unauthorized, notFound, dbError } from '@/lib/crm-auth';
import { adminClient } from '@/lib/supabase-admin';
import { notifyTeammates } from '@/lib/teammate-notify';

// Dated, authored deal notes (crm_deal_notes, append-only). Gated by the parent deal —
// restricted deals 404 for non-owners. Posting a note that @mentions a teammate emails
// them (lib/teammate-notify: de-duped, no self-email, honours crm_profiles.notify_email).

export async function GET(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const dealId = req.nextUrl.searchParams.get('deal_id');
  if (!dealId) return NextResponse.json({ error: 'deal_id required' }, { status: 400 });
  if (!(await assertOwnsResource('crm_deals', dealId, ctx))) return notFound('Deal not found');
  const { data, error } = await adminClient().from('crm_deal_notes')
    .select('id, deal_id, author_id, body, created_at').eq('deal_id', dealId)
    .order('created_at', { ascending: false }).limit(500);
  if (error) return dbError('api/crm/deal-notes GET', error);
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const ctx = await getCrmContext(req);
  if (!ctx) return unauthorized();
  const b = await req.json().catch(() => null);
  const dealId = String(b?.deal_id ?? '');
  const text = String(b?.body ?? '').trim();
  if (!dealId || !text) return NextResponse.json({ error: 'deal_id and body required' }, { status: 400 });
  if (text.length > 10000) return NextResponse.json({ error: 'Note too long' }, { status: 400 });
  const deal = await assertOwnsResource('crm_deals', dealId, ctx);
  if (!deal) return notFound('Deal not found');

  const db = adminClient();
  const { data, error } = await db.from('crm_deal_notes')
    .insert({ deal_id: dealId, author_id: ctx.userId, body: text }).select('id, deal_id, author_id, body, created_at').single();
  if (error) return dbError('api/crm/deal-notes POST', error);
  await db.from('crm_deals').update({ last_touch: new Date().toISOString().slice(0, 10) }).eq('id', dealId);

  // @FirstName mentions → teammates
  const hits = Array.from(new Set([...text.matchAll(/@(\w+)/g)].map(m => m[1].toLowerCase())));
  let notified = 0;
  if (hits.length) {
    const { data: profs } = await db.from('crm_profiles').select('id, first_name');
    const ids = (profs ?? []).filter(p => hits.includes(String(p.first_name ?? '').toLowerCase())).map(p => p.id as string);
    if (ids.length) {
      const { data: d } = await db.from('crm_deals').select('client, property').eq('id', dealId).maybeSingle();
      const r = await notifyTeammates({
        kind: 'mention', recipientIds: ids, actorId: ctx.userId, entityType: 'deal', entityId: dealId,
        entityLabel: [d?.client, d?.property].filter(Boolean).join(' — ') || 'a deal', excerpt: text,
        restricted: !!deal.is_restricted,
        allowedIds: [deal.agent_id as string, ...(((deal.assigned_agent_ids as string[] | null) ?? []))],
      }).catch(e => { console.error('[deal-notes] notify', e); return { notified: 0 }; });
      notified = r.notified;
    }
  }
  return NextResponse.json({ note: data, notified });
}
