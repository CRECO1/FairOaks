import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendPushToProfiles, crmLink } from '@/lib/push';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/property-inquiry-digest — weekdays ~9 AM CT. One phone alert per listing agent: who #-tagged a property they list since
 * the last run (contact notes and logged touches, calls, deal notes and meetings, tasks). Only devices that switched on the
 * "Property inquiries" alert get it (off by default). Secured by CRON_SECRET.
 * Mondays look back over the weekend. Counts only — the names stay behind the CRM's normal access rules.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = adminClient();
  const hours = new Date().getUTCDay() === 1 ? 72 : 24;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  const sources: [string, string][] = [
    ['crm_client_activities', 'created_at'], ['crm_call_log', 'started_at'], ['crm_deal_notes', 'created_at'],
    ['crm_deal_meetings', 'created_at'], ['crm_tasks', 'created_at'],
  ];
  const counts = new Map<string, number>();   // listing id -> new tagged items
  for (const [table, col] of sources) {
    const { data, error } = await db.from(table).select('tagged_listing_ids').gt(col, since).not('tagged_listing_ids', 'eq', '{}').limit(2000);
    if (error) { console.error('[property-inquiry-digest]', table, error.message); continue; }
    for (const r of data ?? []) for (const id of ((r as { tagged_listing_ids: string[] | null }).tagged_listing_ids ?? [])) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  if (!counts.size) return NextResponse.json({ listings: 0, sent: 0 });

  const { data: lst } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids').in('id', [...counts.keys()]);
  const byAgent = new Map<string, { id: string; label: string; n: number }[]>();
  for (const l of lst ?? []) {
    const label = String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'a property');
    const people = new Set<string>([l.listing_agent_id as string | null, ...(((l.assigned_agent_ids as string[] | null) ?? []))].filter((x): x is string => !!x));
    for (const pid of people) byAgent.set(pid, [...(byAgent.get(pid) ?? []), { id: l.id as string, label, n: counts.get(l.id as string) ?? 0 }]);
  }
  let sent = 0;
  for (const [pid, rows] of byAgent) {
    const total = rows.reduce((a, r) => a + r.n, 0);
    const body = rows.sort((a, b) => b.n - a.n).slice(0, 3).map(r => `${r.label} (${r.n})`).join(', ') + (rows.length > 3 ? ` +${rows.length - 3} more` : '');
    const r = await sendPushToProfiles([pid], {
      title: `${total} new ${total === 1 ? 'inquiry' : 'inquiries'} on your listings`,
      body, url: rows.length === 1 ? crmLink('properties', { type: 'listing', id: rows[0].id }) : crmLink('properties'),
      tag: 'property-inquiries', category: 'inquiries',
    }, { db });
    sent += r.sent;
  }
  return NextResponse.json({ listings: counts.size, agents: byAgent.size, sent });
}
