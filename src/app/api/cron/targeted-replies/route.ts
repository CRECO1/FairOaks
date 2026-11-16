import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { listingTagToken } from '@/lib/listing-tags';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/targeted-replies — daily. When someone we reached out to about a property (🎯 targeted) writes back, they have asked: the
 * property moves off their targeted list and onto their "asked" record. Done by logging a note on the contact ("↩ Replied to our outreach
 * about #1222Chulie") that carries the property tag, so it shows on the contact card and the property's "Asked about" list. Their own notes
 * are never edited. A reply is any email received from them since they were marked. Secured by CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = adminClient();
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < 10000; from += 1000) {
    const { data, error } = await db.from('crm_clients').select('id, agent_id, targeted_listing_ids, targeted_at').not('targeted_listing_ids', 'eq', '{}').order('id').range(from, from + 999);
    if (error) { console.error('[targeted-replies]', error.message); return NextResponse.json({ error: 'query failed' }, { status: 500 }); }
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  if (!rows.length) return NextResponse.json({ checked: 0, converted: 0 });

  const replied = new Set<string>();
  const ids = rows.map(r => r.id as string);
  for (let i = 0; i < ids.length; i += 200) {
    const { data: em } = await db.from('crm_deal_emails').select('client_id, email_date').eq('direction', 'received').in('client_id', ids.slice(i, i + 200)).limit(1000);
    for (const e of em ?? []) {
      const c = rows.find(x => x.id === e.client_id);
      if (c && String(e.email_date ?? '') >= String(c.targeted_at ?? '').slice(0, 10)) replied.add(e.client_id as string);
    }
  }
  const { data: lst } = await db.from('crm_listings').select('id, name, address').in('id', [...new Set(rows.flatMap(r => (r.targeted_listing_ids as string[]) ?? []))]);
  const lmap = new Map((lst ?? []).map(l => [l.id as string, l]));
  let converted = 0;
  for (const c of rows) {
    if (!replied.has(c.id as string)) continue;
    for (const lid of ((c.targeted_listing_ids as string[]) ?? [])) {
      const l = lmap.get(lid); if (!l) continue;
      const token = listingTagToken({ id: lid, name: l.name as string | null, address: l.address as string | null });
      const { error } = await db.from('crm_client_activities').insert([{ client_id: c.id, agent_id: c.agent_id ?? null, type: 'note', note: `↩ Replied to our outreach about #${token}`, tagged_listing_ids: [lid] }]);
      if (error) { console.error('[targeted-replies] activity insert', error.message); continue; }
      const left = ((c.targeted_listing_ids as string[]) ?? []).filter(x => x !== lid);
      await db.from('crm_clients').update({ targeted_listing_ids: left }).eq('id', c.id as string);
      c.targeted_listing_ids = left; converted++;
    }
  }
  return NextResponse.json({ checked: rows.length, replied: replied.size, converted });
}
