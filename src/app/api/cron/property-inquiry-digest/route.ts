import { NextRequest, NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-admin';
import { sendPushToProfiles, crmLink } from '@/lib/push';
import { buildInquiries } from '@/lib/listing-inquiries';

export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/property-inquiry-digest — weekdays ~9 AM CT. One phone alert per listing agent: who #-tagged a property they list since
 * the last run (contact notes and logged touches, calls, deal notes and meetings, tasks). Only devices that switched on the
 * "Property inquiries" alert get it (off by default). Secured by CRON_SECRET.
 * Mondays look back over the weekend. Names appear only for contacts in the listing's own workspace that are not new-lead holds
 * (the same rule the property's "Asked about" list uses); deals and tasks are counted, never named.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = adminClient();
  const hours = new Date().getUTCDay() === 1 ? 72 : 24;
  const since = new Date(Date.now() - hours * 3_600_000).toISOString();
  type Src = { table: string; col: string; contact?: string };
  const sources: Src[] = [
    { table: 'crm_client_activities', col: 'created_at', contact: 'client_id' }, { table: 'crm_call_log', col: 'started_at', contact: 'contact_id' },
    { table: 'crm_deal_notes', col: 'created_at' }, { table: 'crm_deal_meetings', col: 'created_at' }, { table: 'crm_tasks', col: 'created_at' },
  ];
  const counts = new Map<string, number>();                    // listing id -> new tagged items
  const whoByListing = new Map<string, Set<string>>();         // listing id -> contact ids behind them
  for (const s of sources) {
    const { data, error } = await db.from(s.table).select(`tagged_listing_ids${s.contact ? `, ${s.contact}` : ''}`).gt(s.col, since).not('tagged_listing_ids', 'eq', '{}').limit(1000);
    if (error) { console.error('[property-inquiry-digest]', s.table, error.message); continue; }
    for (const r of (data ?? []) as unknown as Record<string, unknown>[]) for (const id of ((r.tagged_listing_ids as string[] | null) ?? [])) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const cid = s.contact ? (r[s.contact] as string | null) : null;
      if (cid) whoByListing.set(id, (whoByListing.get(id) ?? new Set()).add(cid));
    }
  }
  if (!counts.size) return NextResponse.json({ listings: 0, sent: 0 });

  const { data: lst } = await db.from('crm_listings').select('id, name, address, business_unit, listing_agent_id, assigned_agent_ids').in('id', [...counts.keys()]);
  const contactIds = [...new Set([...whoByListing.values()].flatMap(s => [...s]))];
  const names = new Map<string, { name: string; unit: string | null }>();
  if (contactIds.length) {
    const { data: cs } = await db.from('crm_clients').select('id, first_name, last_name, business_name, business_unit, lead_hold').in('id', contactIds.slice(0, 500)).eq('lead_hold', false);
    for (const c of cs ?? []) names.set(c.id as string, { name: (c.business_name as string) || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim(), unit: c.business_unit as string | null });
  }

  const byAgent = new Map<string, { id: string; label: string; n: number; who: string[] }[]>();
  for (const l of lst ?? []) {
    const label = String(l.address ?? '').split(',')[0].trim() || String(l.name ?? 'a property');
    const who = [...(whoByListing.get(l.id as string) ?? [])].map(id => names.get(id)).filter((x): x is { name: string; unit: string | null } => !!x && !!x.name && x.unit === l.business_unit).map(x => x.name);
    const people = new Set<string>([l.listing_agent_id as string | null, ...(((l.assigned_agent_ids as string[] | null) ?? []))].filter((x): x is string => !!x));
    for (const pid of people) byAgent.set(pid, [...(byAgent.get(pid) ?? []), { id: l.id as string, label, n: counts.get(l.id as string) ?? 0, who }]);
  }
  const describe = (r: { label: string; n: number; who: string[] }) => {
    if (!r.who.length) return `${r.label} (${r.n})`;
    const shown = r.who.slice(0, 2).join(' and ');
    return `${shown}${r.who.length > 2 ? ` +${r.who.length - 2}` : ''} on ${r.label}`;
  };
  // Also say how many people still haven't been called back on their listings (asked a week or more ago, nothing logged since).
  const { data: profs } = await db.from('crm_profiles').select('id, role, business_unit').in('id', [...byAgent.keys()]);
  const prof = new Map((profs ?? []).map(p => [p.id as string, p]));
  const allIds = [...new Set((lst ?? []).map(l => l.id as string))];
  const waiting = new Map<string, number>();
  for (const [pid, rows] of byAgent) {
    const me = prof.get(pid); if (!me) continue;
    const ctx = { userId: pid, role: (me.role as string | null) ?? null, businessUnit: (me.business_unit as string | null) ?? null };
    let n = 0;
    for (const id of allIds.filter(i => rows.some(r => r.id === i))) { const r = await buildInquiries(ctx, id).catch(() => null); if (r?.ok) n += r.items.filter(i => i.needs_follow_up).length; }
    if (n) waiting.set(pid, n);
  }
  let sent = 0;
  for (const [pid, rows] of byAgent) {
    const total = rows.reduce((a, r) => a + r.n, 0);
    const body = rows.sort((a, b) => b.n - a.n).slice(0, 3).map(describe).join('; ') + (rows.length > 3 ? ` +${rows.length - 3} more` : '');
    const r = await sendPushToProfiles([pid], {
      title: `${total} new ${total === 1 ? 'inquiry' : 'inquiries'} on your listings`,
      body: body + (waiting.get(pid) ? ` · ${waiting.get(pid)} still waiting on a call-back` : ''), url: rows.length === 1 ? crmLink('properties', { type: 'listing', id: rows[0].id }) : crmLink('properties'),
      tag: 'property-inquiries', category: 'inquiries',
    }, { db });
    sent += r.sent;
  }
  return NextResponse.json({ listings: counts.size, agents: byAgent.size, sent });
}
